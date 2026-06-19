"""Environmental scanning: the data-acquisition layer of the foresight pipeline.

Implements a hybrid scan over curated RSS feeds and site-restricted DuckDuckGo
queries against trusted German/EU energy-sector domains, with a deterministic
synthetic fallback when no live source is reachable (keeps demos/offline runs
working). Network I/O runs in parallel; merge and deduplication stay sequential
to keep results reproducible.
"""

from __future__ import annotations

import hashlib
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import mktime

import feedparser
import httpx

from app.models import SourceItem


@dataclass(frozen=True)
class Feed:
    name: str
    url: str
    trust_score: float


# Curated RSS feeds reachable without API keys.
# trust_score is a hand-assigned credibility weight on a 0-1 scale, reflecting
# editorial quality and energy-topic relevance. It feeds into the heuristic
# confidence baseline (workflow._confidence) and is surfaced per case in the UI.
# Government/regulator sources rank highest (~0.9), curated trade press lower.
FEEDS: list[Feed] = [
    Feed("Clean Energy Wire", "https://www.cleanenergywire.org/rss.xml", 0.88),
    Feed("Energy Monitor", "https://www.energymonitor.ai/feed", 0.78),
    Feed("Climate Change News", "https://www.climatechangenews.com/feed/", 0.74),
    Feed("Renewable Energy World", "https://www.renewableenergyworld.com/feed/", 0.70),
]

_HTTP_TIMEOUT = 8.0
_USER_AGENT = "Mozilla/5.0 (compatible; ForesightAgent/1.0; +https://example.local)"
_HTML_TAG_RE = re.compile(r"<[^>]+>")
# Cap the candidates kept per search term to bound the per-run case count (and
# thus LLM cost); RSS matches are ranked by recency before this cut applies.
_MAX_HITS_PER_TERM = 4
_DDG_MAX_RESULTS = 8


# Domains to search via DuckDuckGo as site-restricted queries.
# Order matters only for trust-score lookup; the first matching domain wins.
_DDG_SITES: list[tuple[str, str, float]] = [
    # Government / regulators
    ("BMWK", "bmwk.de", 0.92),
    ("Bundesnetzagentur", "bundesnetzagentur.de", 0.92),
    ("Bundestag", "bundestag.de", 0.90),
    ("EC Energy", "energy.ec.europa.eu", 0.88),
    # Think tanks / institutes
    ("Agora Energiewende", "agora-energiewende.org", 0.88),
    ("Fraunhofer ISE", "fraunhofer.de", 0.88),
    ("DENA", "dena.de", 0.85),
    ("IEA", "iea.org", 0.90),
    # Quality news
    ("Tagesschau", "tagesschau.de", 0.82),
    ("Handelsblatt", "handelsblatt.com", 0.78),
    ("Heise", "heise.de", 0.78),
    # Specialist trade press
    ("PV Magazine DE", "pv-magazine.de", 0.75),
    ("Energie & Management", "energie-und-management.de", 0.72),
]


def _strip_html(text: str) -> str:
    return _HTML_TAG_RE.sub("", text or "").strip()


def _parse_published(entry: dict) -> str | None:
    for field in ("published_parsed", "updated_parsed"):
        struct = entry.get(field)
        if struct:
            try:
                return datetime.utcfromtimestamp(mktime(struct)).date().isoformat()
            except Exception:
                continue
    for field in ("published", "updated"):
        value = entry.get(field)
        if value:
            return str(value)[:10]
    return None


def _fetch_feed(feed: Feed) -> list[dict]:
    try:
        response = httpx.get(
            feed.url,
            timeout=_HTTP_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": _USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml"},
        )
        response.raise_for_status()
    except Exception as exc:
        print(f"[sources] feed fetch failed for {feed.name}: {exc}")
        return []

    parsed = feedparser.parse(response.content)
    entries: list[dict] = []
    for raw in parsed.entries:
        title = _strip_html(raw.get("title", ""))
        summary = _strip_html(raw.get("summary", "") or raw.get("description", ""))
        link = raw.get("link", "")
        if not (title and link):
            continue
        entries.append(
            {
                "title": title,
                "summary": summary,
                "link": link,
                "published": _parse_published(raw),
                "feed": feed,
            }
        )
    return entries


def _entry_matches_term(entry: dict, term: str) -> bool:
    needle = term.lower()
    haystack = f"{entry['title']} {entry['summary']}".lower()
    if needle in haystack:
        return True
    tokens = [token for token in re.split(r"\s+", needle) if len(token) >= 4]
    if not tokens:
        return False
    return all(token in haystack for token in tokens)


def _identify_ddg_source(url: str) -> tuple[str, float]:
    """Find which curated domain a DDG result belongs to and return name/trust."""
    lower = (url or "").lower()
    for name, domain, trust in _DDG_SITES:
        if domain in lower:
            return name, trust
    return "DuckDuckGo", 0.65


def _ddg_search_term(term: str) -> list[dict]:
    """Site-restricted DuckDuckGo search across the curated _DDG_SITES list."""
    try:
        from ddgs import DDGS  # type: ignore
    except Exception as exc:
        print(f"[sources] ddgs import failed: {exc}")
        return []

    site_or = " OR ".join(f"site:{domain}" for _, domain, _ in _DDG_SITES)
    query = f"{term} ({site_or})"

    try:
        raw_results = list(
            DDGS().text(query, max_results=_DDG_MAX_RESULTS, region="de-de")
        )
    except Exception as exc:
        print(f"[sources] DDG search failed for term='{term}': {exc}")
        return []

    entries: list[dict] = []
    for r in raw_results:
        url = r.get("href") or r.get("url") or ""
        title = _strip_html(r.get("title", ""))
        snippet = _strip_html(r.get("body", "") or r.get("snippet", ""))
        if not (url and title):
            continue
        name, trust = _identify_ddg_source(url)
        entries.append(
            {
                "title": title,
                "summary": snippet,
                "link": url,
                "published": None,  # DDG does not reliably expose dates
                "feed": Feed(name, "", trust),
            }
        )
    return entries


# --- Synthetic fallback (used when no live RSS data is available) ------------

_FALLBACK_BASE_URLS = [
    "https://www.iea.org/news",
    "https://energy.ec.europa.eu/news_en",
    "https://www.cleanenergywire.org/news",
    "https://www.bmwk.de/Redaktion/EN",
    "https://www.agora-energiewende.org/publications",
]


def _fallback_score(text: str) -> float:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    value = int(digest[:8], 16) % 100
    return round(0.45 + (value / 100) * 0.5, 2)


def _fallback_sources(search_terms: list[str]) -> list[dict]:
    items: list[dict] = []
    now = datetime.now(timezone.utc)
    for i, term in enumerate(search_terms):
        for j in range(2):
            base = _FALLBACK_BASE_URLS[(i + j) % len(_FALLBACK_BASE_URLS)]
            published = (now - timedelta(days=(i + j) % 21)).date().isoformat()
            title = f"{term.title()} update {j + 1}"
            url = f"{base}/{term.lower().replace(' ', '-')}-{j + 1}"
            snippet = (
                f"[fallback] Synthetic placeholder for '{term}'. "
                "Live RSS feeds were unreachable; values are deterministic stand-ins."
            )
            items.append(
                {
                    "keyword": term,
                    "source": SourceItem(
                        title=title,
                        url=url,
                        snippet=snippet,
                        published_at=published,
                        trust_score=_fallback_score(url),
                    ),
                }
            )
    return items


def search_sources(search_terms: list[str]) -> list[dict]:
    # Network I/O runs in parallel; the merge + dedup below stays sequential so
    # the result is fully deterministic regardless of completion order. Each
    # feed is fetched exactly once and each term queried exactly once — parallel
    # execution only overlaps the waiting, it never re-scans a source.

    # 1) RSS feeds in parallel (each fetched once, then filtered per term).
    rss_entries: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(len(FEEDS), 1)) as pool:
        for entries in pool.map(_fetch_feed, FEEDS):
            rss_entries.extend(entries)

    # 2) Site-restricted DuckDuckGo search per term, in parallel. Results are
    #    keyed by term so the assembly step below can read them deterministically.
    ddg_by_term: dict[str, list[dict]] = {}
    if search_terms:
        with ThreadPoolExecutor(max_workers=min(len(search_terms), 8)) as pool:
            futures = {pool.submit(_ddg_search_term, term): term for term in search_terms}
            for fut in as_completed(futures):
                term = futures[fut]
                ddg_by_term[term] = fut.result()

    items: list[dict] = []
    seen: set[tuple[str, str]] = set()
    rss_hit_counts: dict[str, int] = {}
    ddg_hit_counts: dict[str, int] = {}

    for term in search_terms:
        # RSS matches for this term
        rss_matches = [entry for entry in rss_entries if _entry_matches_term(entry, term)]
        rss_matches.sort(key=lambda e: e.get("published") or "", reverse=True)

        ddg_matches = ddg_by_term.get(term, [])

        rss_hit_counts[term] = len(rss_matches)
        ddg_hit_counts[term] = len(ddg_matches)

        # Combine: RSS first (it has dates → ranked by recency); DDG appended.
        combined = rss_matches + ddg_matches

        for entry in combined[:_MAX_HITS_PER_TERM]:
            key = (term, entry["link"])
            if key in seen:
                continue
            seen.add(key)

            snippet = entry["summary"][:480] or f"Article in {entry['feed'].name} mentioning '{term}'."
            items.append(
                {
                    "keyword": term,
                    "source": SourceItem(
                        title=entry["title"],
                        url=entry["link"],
                        snippet=snippet,
                        published_at=entry["published"],
                        trust_score=entry["feed"].trust_score,
                    ),
                }
            )

    total_rss = sum(rss_hit_counts.values())
    total_ddg = sum(ddg_hit_counts.values())
    print(f"[sources] hits: RSS={total_rss} DDG={total_ddg} merged={len(items)}")

    if not items:
        print("[sources] no live hits — using synthetic fallback sources")
        return _fallback_sources(search_terms)

    return items

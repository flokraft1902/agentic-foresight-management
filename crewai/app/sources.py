from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from app.models import SourceItem


_BASE_URLS = [
    "https://www.iea.org/news",
    "https://energy.ec.europa.eu/news_en",
    "https://www.cleanenergywire.org/news",
    "https://www.bmwk.de/Redaktion/EN",
    "https://www.agora-energiewende.org/publications",
]


def _score_from_text(text: str) -> float:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    value = int(digest[:8], 16) % 100
    return round(0.45 + (value / 100) * 0.5, 2)


def search_sources(search_terms: list[str]) -> list[dict]:
    items: list[dict] = []
    now = datetime.utcnow()

    for i, term in enumerate(search_terms):
        for j in range(2):
            base = _BASE_URLS[(i + j) % len(_BASE_URLS)]
            published = (now - timedelta(days=(i + j) % 21)).date().isoformat()
            title = f"{term.title()} update {j + 1}"
            url = f"{base}/{term.lower().replace(' ', '-')}-{j + 1}"
            snippet = (
                f"New development for '{term}' with implications for supply security, cost, "
                "and decarbonization pathways in Europe."
            )
            items.append(
                {
                    "keyword": term,
                    "source": SourceItem(
                        title=title,
                        url=url,
                        snippet=snippet,
                        published_at=published,
                        trust_score=_score_from_text(url),
                    ),
                }
            )

    return items

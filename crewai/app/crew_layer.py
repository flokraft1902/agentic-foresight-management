from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Callable

from app.config import settings

try:
    from crewai import Agent, Crew, LLM, Process, Task  # type: ignore
except Exception:  # pragma: no cover
    Agent = None
    Crew = None
    LLM = None
    Process = None
    Task = None


@dataclass
class CrewSummary:
    used_crewai: bool
    text: str


@dataclass
class LLMProbe:
    ok: bool
    status: str
    detail: str


@dataclass
class Classification:
    is_signal: bool
    confidence: float
    ansoff_level: int
    rationale: str
    pestel_category: str | None
    zieldreieck_dimensions: list[str]
    source: str  # "llm" | "heuristic"


_VALID_PESTEL = {"P", "E", "S", "T", "En", "L"}
_VALID_ZIELDREIECK = {"wirtschaftlichkeit", "versorgungssicherheit", "umweltvertraeglichkeit"}


_CLASSIFY_PROMPT = (
    "You are a strategic foresight analyst classifying weak signals in the energy sector.\n\n"
    "Strategic focus:\n{focus}\n\n"
    "Article to evaluate:\n"
    "- Search term: {term}\n"
    "- Title: {title}\n"
    "- Snippet: {snippet}\n"
    "- Published: {published}\n\n"
    "Tasks:\n"
    "1. Decide whether this article is a strategic weak signal relevant to the focus, or noise.\n"
    "2. Estimate your confidence between 0 and 1.\n"
    "3. Assign an Ansoff matrix level:\n"
    "   1 = Sense of threat (vague), 2 = Source known, 3 = Threat characterized, 4 = Response known.\n"
    "4. Assign exactly one PESTEL category:\n"
    "   P (Political), E (Economic), S (Social), T (Technological), En (Environmental), L (Legal).\n"
    "5. Assign one or more affected dimensions of the German energy policy triangle (§1 EnWG):\n"
    "   wirtschaftlichkeit, versorgungssicherheit, umweltvertraeglichkeit.\n\n"
    "Respond with ONLY a JSON object, no markdown fences or commentary, in this exact shape:\n"
    '{{"is_signal": true|false, "confidence": 0.0-1.0, "ansoff_level": 1|2|3|4, '
    '"pestel_category": "P|E|S|T|En|L", '
    '"zieldreieck_dimensions": ["wirtschaftlichkeit"|"versorgungssicherheit"|"umweltvertraeglichkeit"], '
    '"rationale": "one concise sentence"}}'
)


def _extract_json(text: str) -> dict | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def classify_case(
    term: str,
    title: str,
    snippet: str,
    focus: str,
    published: str | None = None,
    heuristic_fallback: "Classification | None" = None,
) -> Classification:
    """Ask the LLM to classify a single case. Falls back to the provided heuristic on any failure."""

    if not settings.llm_api_key:
        return heuristic_fallback or _default_heuristic(term)

    try:
        from litellm import completion  # type: ignore
    except Exception:
        return heuristic_fallback or _default_heuristic(term)

    prompt = _CLASSIFY_PROMPT.format(
        focus=focus or "(none provided)",
        term=term,
        title=title or "(no title)",
        snippet=(snippet or "")[:600],
        published=published or "unknown",
    )

    try:
        response = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=220,
            temperature=0.1,
            timeout=30,
        )
        text = response.choices[0].message.content or ""
    except Exception as exc:
        print(f"[classify_case] LLM call failed for term='{term}': {exc}")
        return heuristic_fallback or _default_heuristic(term)

    payload = _extract_json(text)
    if not payload:
        print(f"[classify_case] could not parse JSON for term='{term}'. Raw: {text[:160]}")
        return heuristic_fallback or _default_heuristic(term)

    try:
        is_signal = bool(payload["is_signal"])
        confidence = max(0.0, min(1.0, float(payload["confidence"])))
        ansoff_level = int(payload["ansoff_level"])
        if ansoff_level not in (1, 2, 3, 4):
            ansoff_level = max(1, min(4, ansoff_level))
        rationale = str(payload.get("rationale", "")).strip() or "Classified by LLM."

        raw_pestel = str(payload.get("pestel_category", "") or "").strip()
        pestel_category = raw_pestel if raw_pestel in _VALID_PESTEL else None

        raw_dims = payload.get("zieldreieck_dimensions") or []
        if isinstance(raw_dims, str):
            raw_dims = [raw_dims]
        zieldreieck = [d for d in raw_dims if isinstance(d, str) and d in _VALID_ZIELDREIECK]
    except (KeyError, TypeError, ValueError) as exc:
        print(f"[classify_case] invalid JSON payload for term='{term}': {exc}; payload={payload}")
        return heuristic_fallback or _default_heuristic(term)

    return Classification(
        is_signal=is_signal,
        confidence=round(confidence, 2),
        ansoff_level=ansoff_level,
        rationale=rationale,
        pestel_category=pestel_category,
        zieldreieck_dimensions=zieldreieck,
        source="llm",
    )


def _default_heuristic(term: str) -> Classification:
    return Classification(
        is_signal=False,
        confidence=0.4,
        ansoff_level=1,
        rationale=f"Heuristic fallback for '{term}': no LLM signal available.",
        pestel_category=None,
        zieldreieck_dimensions=[],
        source="heuristic",
    )


# --- Energy Expert Validation ------------------------------------------------

@dataclass
class ExpertValidation:
    is_valid: bool
    systemic_impact: str  # "HOCH" | "MITTEL" | "GERING"
    time_horizon: str
    zieldreieck_impact: dict[str, str]
    rationale: str
    source: str  # "llm" | "heuristic"


_VALID_IMPACT = {"HOCH", "MITTEL", "GERING"}


_EXPERT_PROMPT = (
    "You are the Energy Expert Agent in a foresight system. Your task is the "
    "domain-specific plausibility check of a weak signal candidate in the German/EU "
    "energy sector. You serve as the hallucination guard for the pipeline.\n\n"
    "Apply this knowledge framework:\n"
    "- Merit-Order: power plants dispatched by ascending marginal cost. Renewables "
    "at ~0 marginal cost push fossils out and lower spot prices.\n"
    "- Missing Money Problem: conventional backup plants struggle to cover fixed "
    "costs in energy-only markets as scarcity prices become rare.\n"
    "- Cannibalisation: rising RE share lowers the market value of wind/solar.\n"
    "- 3D Transformation: decarbonisation + decentralisation + digitalisation.\n"
    "- Zieldreieck (§1 EnWG): Wirtschaftlichkeit, Versorgungssicherheit, Umweltvertraeglichkeit.\n\n"
    "Strategic focus:\n{focus}\n\n"
    "Signal under review:\n"
    "- Title: {title}\n"
    "- Snippet: {snippet}\n"
    "- Search term: {term}\n"
    "- Pre-classification: is_signal={is_signal}, confidence={confidence:.2f}, "
    "ansoff_level={ansoff_level}, pestel={pestel}, zieldreieck={zieldreieck}\n\n"
    "Tasks:\n"
    "1. Decide is_valid: true if the signal is physically AND economically plausible "
    "given the framework, false if it contradicts known laws (e.g. impossible load "
    "flows, free-energy claims, ignores Merit-Order).\n"
    "2. Estimate systemic_impact on the energy system: HOCH / MITTEL / GERING.\n"
    "3. Estimate time_horizon as a short German phrase (z.B. '6-18 Monate', "
    "'3-7 Jahre', 'kurzfristig unklar').\n"
    "4. For each affected dimension of the Zieldreieck, write ONE concrete sentence "
    "of impact text. Use only dimensions actually relevant - omit the others.\n"
    "5. Write a 1-2 sentence rationale that names the relevant mechanism "
    "(Merit-Order, Missing Money, Cannibalisation, Netzphysik, etc.).\n\n"
    "Respond with ONLY a JSON object, no markdown fences or commentary:\n"
    "{{\"is_valid\": true|false, \"systemic_impact\": \"HOCH|MITTEL|GERING\", "
    "\"time_horizon\": \"...\", \"zieldreieck_impact\": "
    "{{\"wirtschaftlichkeit\": \"...\", \"versorgungssicherheit\": \"...\", "
    "\"umweltvertraeglichkeit\": \"...\"}}, \"rationale\": \"...\"}}"
)


def suggest_search_terms(
    focus: str,
    existing_terms: list[str],
    validated_cases: list[dict],
    max_suggestions: int = 5,
) -> list[str]:
    """Ask the LLM for related search terms that would expand coverage based on
    the validated signals from the latest run. Returns [] on any failure."""

    if not settings.llm_api_key or not validated_cases:
        return []

    try:
        from litellm import completion  # type: ignore
    except Exception:
        return []

    case_lines = "\n".join(
        f"- term='{c.get('keyword','?')}' pestel={c.get('pestel_category','?')} ansoff={c.get('ansoff_level','?')} title={(c.get('title','') or '')[:90]}"
        for c in validated_cases[:12]
    )
    existing = ", ".join(existing_terms) or "(none)"

    prompt = (
        "You are a foresight analyst expanding search coverage based on signals found "
        "in the last run of an energy-foresight system.\n\n"
        f"Strategic focus:\n{focus}\n\n"
        f"Existing search terms (do NOT repeat these):\n{existing}\n\n"
        f"Validated weak signals from the last run:\n{case_lines}\n\n"
        "Task: suggest 3-5 NEW search terms that would surface RELATED weak signals "
        "in subsequent runs. Each term must:\n"
        "- Be in English OR German, matching the topical area\n"
        "- Be specific enough for meaningful search results (avoid 'energy', 'climate' etc.)\n"
        "- Differ semantically from the existing terms (no pure rephrasings)\n"
        "- Cover adjacent PESTEL dimensions or technology areas not yet represented\n\n"
        "Respond with ONLY a JSON array of strings, no commentary, no markdown fences:\n"
        '["term 1", "term 2", "term 3"]'
    )

    try:
        response = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=220,
            temperature=0.3,
            timeout=40,
        )
        text = response.choices[0].message.content or ""
    except Exception as exc:
        print(f"[suggest_search_terms] LLM call failed: {exc}")
        return []

    # Try strict JSON first
    payload = None
    try:
        payload = json.loads(text)
    except Exception:
        match = re.search(r"\[[\s\S]*\]", text)
        if match:
            try:
                payload = json.loads(match.group(0))
            except Exception:
                pass

    if not isinstance(payload, list):
        return []

    cleaned: list[str] = []
    lower_existing = {t.lower().strip() for t in existing_terms}
    for raw in payload:
        if not isinstance(raw, str):
            continue
        term = raw.strip().strip('"').strip("'")
        if not term or len(term) < 3 or len(term) > 80:
            continue
        if term.lower() in lower_existing:
            continue
        if term in cleaned:
            continue
        cleaned.append(term)
        if len(cleaned) >= max_suggestions:
            break
    return cleaned


def _default_expert_heuristic(confidence: float) -> ExpertValidation:
    impact = "HOCH" if confidence >= 0.82 else "MITTEL" if confidence >= 0.6 else "GERING"
    return ExpertValidation(
        is_valid=True,
        systemic_impact=impact,
        time_horizon="unklar",
        zieldreieck_impact={},
        rationale=(
            "Heuristik-Fallback: kein LLM-Experten-Call verfuegbar. "
            f"Bewertung basiert ausschliesslich auf Confidence={confidence:.2f}."
        ),
        source="heuristic",
    )


def validate_case_expert(
    title: str,
    snippet: str,
    term: str,
    focus: str,
    is_signal: bool,
    confidence: float,
    ansoff_level: int,
    pestel_category: str | None,
    zieldreieck_dimensions: list[str],
    heuristic_fallback: "ExpertValidation | None" = None,
) -> ExpertValidation:
    """Domain validation of a single case via the energy expert LLM."""

    if not settings.llm_api_key:
        return heuristic_fallback or _default_expert_heuristic(confidence)

    try:
        from litellm import completion  # type: ignore
    except Exception:
        return heuristic_fallback or _default_expert_heuristic(confidence)

    prompt = _EXPERT_PROMPT.format(
        focus=focus or "(none)",
        title=title or "(no title)",
        snippet=(snippet or "")[:600],
        term=term,
        is_signal=is_signal,
        confidence=confidence,
        ansoff_level=ansoff_level,
        pestel=pestel_category or "?",
        zieldreieck=", ".join(zieldreieck_dimensions) or "?",
    )

    try:
        response = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=380,
            temperature=0.15,
            timeout=45,
        )
        text = response.choices[0].message.content or ""
    except Exception as exc:
        print(f"[validate_case_expert] LLM call failed: {exc}")
        return heuristic_fallback or _default_expert_heuristic(confidence)

    payload = _extract_json(text)
    if not payload:
        print(f"[validate_case_expert] could not parse JSON. Raw: {text[:160]}")
        return heuristic_fallback or _default_expert_heuristic(confidence)

    try:
        is_valid = bool(payload["is_valid"])
        impact = str(payload.get("systemic_impact", "")).strip().upper()
        if impact not in _VALID_IMPACT:
            impact = "MITTEL"
        time_horizon = str(payload.get("time_horizon", "")).strip() or "unklar"
        rationale = str(payload.get("rationale", "")).strip() or "Validated by LLM."

        raw_imp = payload.get("zieldreieck_impact") or {}
        zieldreieck_impact: dict[str, str] = {}
        if isinstance(raw_imp, dict):
            for k in ("wirtschaftlichkeit", "versorgungssicherheit", "umweltvertraeglichkeit"):
                v = raw_imp.get(k)
                if isinstance(v, str):
                    v = v.strip()
                    if v and v.lower() not in ("none", "n/a", "-", ""):
                        zieldreieck_impact[k] = v[:280]
    except (KeyError, TypeError, ValueError) as exc:
        print(f"[validate_case_expert] invalid payload: {exc}; payload={payload}")
        return heuristic_fallback or _default_expert_heuristic(confidence)

    return ExpertValidation(
        is_valid=is_valid,
        systemic_impact=impact,
        time_horizon=time_horizon[:60],
        zieldreieck_impact=zieldreieck_impact,
        rationale=rationale[:400],
        source="llm",
    )


def probe_llm() -> LLMProbe:
    if not settings.llm_api_key:
        return LLMProbe(ok=False, status="no_api_key", detail="LLM_API_KEY is not set in .env.")
    if LLM is None:
        return LLMProbe(
            ok=False,
            status="crewai_missing",
            detail="CrewAI runtime is not installed; cannot reach the LLM.",
        )

    try:
        from litellm import completion  # type: ignore
    except Exception as exc:
        return LLMProbe(ok=False, status="litellm_missing", detail=f"litellm import failed: {exc}")

    try:
        response = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=5,
        )
        text = ""
        try:
            text = response.choices[0].message.content or ""
        except Exception:
            text = str(response)[:120]
        return LLMProbe(ok=True, status="live", detail=f"LLM reachable. Reply: {text.strip()[:120]}")
    except Exception as exc:
        return LLMProbe(ok=False, status="probe_failed", detail=str(exc)[:400])


_SUMMARY_PROMPT = (
    "You are a foresight analyst summarizing one workflow stage in a multi-agent system.\n\n"
    "Stage: {stage_name}\n"
    "Objective: {objective}\n\n"
    "Structured payload for this stage:\n{payload}\n\n"
    "Produce a concise summary in markdown with three short sections:\n"
    "## Findings\n## Uncertainty\n## Reviewer Checkpoints\n\n"
    "Keep each section to 2-4 bullet points. Be specific, no boilerplate."
)


def summarize_stage(
    stage_name: str,
    objective: str,
    payload: dict,
    on_chunk: "Callable[[str], None] | None" = None,
) -> CrewSummary:
    """Generate a stage summary by streaming tokens from the LLM.

    If ``on_chunk`` is provided, it is called periodically with the accumulated
    text so far (UI can show the summary as it grows).
    """

    if not settings.llm_api_key:
        return CrewSummary(
            used_crewai=False,
            text=f"Fallback mode for stage '{stage_name}'. LLM_API_KEY is not set.",
        )

    try:
        from litellm import completion  # type: ignore
    except Exception as exc:
        return CrewSummary(
            used_crewai=False,
            text=f"Fallback mode for stage '{stage_name}'. litellm import failed: {exc}",
        )

    prompt = _SUMMARY_PROMPT.format(
        stage_name=stage_name,
        objective=objective,
        payload=json.dumps(payload, ensure_ascii=False, default=str)[:2000],
    )

    accumulated: list[str] = []
    last_emit = 0.0
    emit_interval = 0.5  # seconds between disk writes

    try:
        stream = completion(
            model=settings.llm_model,
            api_key=settings.llm_api_key,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            temperature=0.2,
            max_tokens=600,
            timeout=60,
        )
        for chunk in stream:
            try:
                delta = chunk.choices[0].delta.content or ""
            except Exception:
                delta = ""
            if not delta:
                continue
            accumulated.append(delta)
            now = time.time()
            if on_chunk and (now - last_emit) >= emit_interval:
                try:
                    on_chunk("".join(accumulated))
                except Exception as cb_exc:
                    print(f"[summarize_stage] on_chunk callback failed: {cb_exc}")
                last_emit = now
    except Exception as exc:
        print(f"[summarize_stage] streaming failed for '{stage_name}': {exc}")
        if not accumulated:
            return CrewSummary(
                used_crewai=False,
                text=f"Fallback mode for stage '{stage_name}'. LLM call failed: {exc}",
            )

    final_text = "".join(accumulated).strip() or f"(empty LLM response for stage '{stage_name}')"
    if on_chunk:
        try:
            on_chunk(final_text)
        except Exception as cb_exc:
            print(f"[summarize_stage] final on_chunk failed: {cb_exc}")
    return CrewSummary(used_crewai=True, text=final_text)

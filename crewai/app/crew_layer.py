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
    source: str  # "llm" | "heuristic"


_CLASSIFY_PROMPT = (
    "You are a strategic foresight analyst classifying weak signals in the energy sector.\n\n"
    "Strategic focus:\n{focus}\n\n"
    "Article to evaluate:\n"
    "- Search term: {term}\n"
    "- Title: {title}\n"
    "- Snippet: {snippet}\n"
    "- Published: {published}\n\n"
    "Decide whether this article represents a strategic weak signal relevant to the focus, "
    "or whether it is noise. Estimate your confidence between 0 and 1. Assign an Ansoff matrix "
    "level: 1 = market penetration, 2 = market development, 3 = product development, "
    "4 = diversification.\n\n"
    "Respond with ONLY a JSON object, no markdown fences or commentary, in this exact shape:\n"
    '{{"is_signal": true|false, "confidence": 0.0-1.0, "ansoff_level": 1|2|3|4, "rationale": "one concise sentence"}}'
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
    except (KeyError, TypeError, ValueError) as exc:
        print(f"[classify_case] invalid JSON payload for term='{term}': {exc}; payload={payload}")
        return heuristic_fallback or _default_heuristic(term)

    return Classification(
        is_signal=is_signal,
        confidence=round(confidence, 2),
        ansoff_level=ansoff_level,
        rationale=rationale,
        source="llm",
    )


def _default_heuristic(term: str) -> Classification:
    return Classification(
        is_signal=False,
        confidence=0.4,
        ansoff_level=1,
        rationale=f"Heuristic fallback for '{term}': no LLM signal available.",
        source="heuristic",
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

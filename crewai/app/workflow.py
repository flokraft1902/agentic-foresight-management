"""Orchestration of the multi-agent foresight pipeline.

Runs the four sequential stages — Scanning -> Assessment -> Energy Expert ->
Scenario Integration — with a Human-in-the-Loop (HITL) gate between the Expert
and Scenario stages. Each stage is summarised by an LLM (see crew_layer); the
per-case classification and validation calls are parallelised across a thread
pool. The methodological background (Ansoff weak-signal scale, PESTEL, §1 EnWG
Zieldreieck) is documented in MAS_Foresight_Architektur.md.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from uuid import uuid4

from app.config import settings
from app.crew_layer import (
    Classification,
    ExpertValidation,
    classify_case,
    suggest_search_terms,
    summarize_stage,
    validate_case_expert,
)
from app.data_store import build_url_history, get_search_terms, upsert_cases, upsert_run
from app.models import SignalCase, SourceItem, WorkflowRun, WorkflowStep
from app.sources import search_sources


# Keyword tokens that raise the heuristic confidence of a candidate. These are
# only used by the offline fallback (_confidence) when no LLM is available; the
# primary classification path is the LLM in crew_layer.classify_case.
_SIGNAL_TERMS = [
    "reform",
    "market",
    "capacity",
    "pilot",
    "storage",
    "hydrogen",
    "grid",
    "co2",
    "investment",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _start_step(name: str) -> WorkflowStep:
    return WorkflowStep(name=name, status="running", started_at=_now(), detail={})


def _finish_step(step: WorkflowStep, detail: dict) -> WorkflowStep:
    step.status = "done"
    step.finished_at = _now()
    step.detail = detail
    return step


def _confidence(term: str, source: SourceItem) -> float:
    """Heuristic confidence baseline used as the offline fallback for the LLM
    classifier. The weights are hand-tuned, not learned:
    - base = 0.42: a neutral prior, deliberately below the 0.62 signal cutoff so
      a candidate needs positive evidence to count as a signal.
    - +0.07 per matched signal token: rewards topical keyword overlap.
    - +0.20 * trust_score: weights source credibility (see sources.py trust
      scores). Capped to [0, 1].
    """
    base = 0.42
    token_hits = sum(1 for token in _SIGNAL_TERMS if token in term.lower() or token in source.snippet.lower())
    score = base + token_hits * 0.07 + source.trust_score * 0.2
    return max(0.0, min(round(score, 2), 1.0))


def _ansoff_level(term: str) -> int:
    """Heuristic mapping of a search term to the Ansoff weak-signal scale (1-4),
    used as the offline fallback for the LLM classifier. Following Ansoff's
    information levels: 1 = vague sense of threat, 2 = source known,
    3 = threat/opportunity characterised, 4 = response known. Mature market
    topics score higher (more characterised); emerging tech like hydrogen ranks
    highest as a strategic weak signal. See MAS_Foresight_Architektur.md.
    """
    if "market" in term or "capacity" in term:
        return 3
    if "hydrogen" in term or "storage" in term:
        return 4
    if "grid" in term:
        return 2
    return 1


def _classify_one(
    item: dict,
    run: WorkflowRun,
    focus: str,
    url_history: dict[str, tuple[str, str, int]],
) -> tuple[SignalCase, str]:
    """Classify a single scanned item into a SignalCase. Self-contained so it
    can run inside a ThreadPoolExecutor worker — it only reads local data and
    the shared read-only url_history map (no per-case state load). Returns the
    case plus whether the classification came from the LLM or the heuristic
    fallback."""
    term = item["keyword"]
    source: SourceItem = item["source"]

    # 0.62 is the heuristic signal/noise cutoff: with base=0.42, a candidate
    # needs roughly two signal-token hits or a high trust score to clear it.
    heuristic_conf = _confidence(term, source)
    heuristic = Classification(
        is_signal=heuristic_conf >= 0.62,
        confidence=heuristic_conf,
        ansoff_level=_ansoff_level(term),
        rationale=(
            "Heuristic baseline: trust-score and keyword tokens suggest "
            f"a {'signal' if heuristic_conf >= 0.62 else 'noise'} candidate for '{term}'."
        ),
        pestel_category=None,
        zieldreieck_dimensions=[],
        source="heuristic",
    )

    classification = classify_case(
        term=term,
        title=source.title,
        snippet=source.snippet,
        focus=focus,
        published=source.published_at,
        heuristic_fallback=heuristic,
    )

    prior = url_history.get(source.url)
    if prior is None:
        first_seen_run_id = run.run_id
        first_seen_at = run.created_at
        seen_count = 1
    else:
        prior_run_id, prior_at, prior_count = prior
        first_seen_run_id = prior_run_id
        first_seen_at = prior_at
        seen_count = prior_count + 1

    case = SignalCase(
        case_id=f"case_{uuid4().hex[:10]}",
        run_id=run.run_id,
        keyword=term,
        title=source.title,
        rationale=classification.rationale,
        confidence=classification.confidence,
        is_signal=classification.is_signal,
        ansoff_level=classification.ansoff_level,
        pestel_category=classification.pestel_category,
        zieldreieck_dimensions=list(classification.zieldreieck_dimensions),
        validation_status="pending",
        sources=[source],
        first_seen_run_id=first_seen_run_id,
        first_seen_at=first_seen_at,
        seen_count=seen_count,
    )
    return case, classification.source


def _validate_one(case: SignalCase, focus: str) -> str:
    """Run the energy-expert domain check on a single case, mutating it in
    place. Each worker owns a distinct case object, so the in-place writes are
    thread-safe. Sets expert fields and the resulting validation_status, and
    returns whether the verdict came from the LLM or the heuristic fallback."""
    snippet = case.sources[0].snippet if case.sources else ""

    expert = validate_case_expert(
        title=case.title,
        snippet=snippet,
        term=case.keyword,
        focus=focus,
        is_signal=case.is_signal,
        confidence=case.confidence,
        ansoff_level=case.ansoff_level,
        pestel_category=case.pestel_category,
        zieldreieck_dimensions=list(case.zieldreieck_dimensions),
    )

    case.expert_comment = expert.rationale
    case.expert_valid = expert.is_valid
    case.systemic_impact = expert.systemic_impact  # type: ignore[assignment]
    case.time_horizon = expert.time_horizon
    case.zieldreieck_impact = dict(expert.zieldreieck_impact)

    # Combine the expert's domain verdict with the confidence to decide status.
    # The 0.72 cutoff defines the Human-in-the-Loop band: signals the model is
    # confident about (>= 0.72) auto-validate, while mid-confidence signals
    # (signal but < 0.72) are routed to awaiting_review so a human makes the
    # call. The value is a deliberately conservative operating point — high
    # enough to keep auto-validation trustworthy, low enough to keep the manual
    # review queue manageable. Decision order:
    # - Domain-rejected by the expert overrides everything -> rejected
    # - High-confidence signal -> validated
    # - Mid-confidence signal  -> awaiting_review (HITL gate)
    # - Noise                  -> rejected
    if not expert.is_valid:
        case.validation_status = "rejected"
    elif case.is_signal and case.confidence >= 0.72:
        case.validation_status = "validated"
    elif case.is_signal:
        case.validation_status = "awaiting_review"
    else:
        case.validation_status = "rejected"

    return expert.source


def prepare_run(search_terms: list[str] | None = None, focus: str | None = None) -> WorkflowRun:
    resolved_terms = search_terms or get_search_terms().search_terms
    resolved_focus = focus or settings.default_focus

    run = WorkflowRun(
        run_id=f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}",
        created_at=_now(),
        updated_at=_now(),
        focus=resolved_focus,
        search_terms=resolved_terms,
        status="running",
        steps=[],
        summary={},
    )
    upsert_run(run)
    return run


def _make_streaming_emitter(step: WorkflowStep, run: WorkflowRun):
    """Return a callback that writes partial LLM output into step.detail.crewai.

    Sets ``crewai.streaming = True`` immediately on construction so the UI sees
    the streaming state from the moment ``summarize_stage`` starts — not only
    once the first LLM chunk arrives. Without this, short-output stages
    (Scanning, Assessment, Expert) finish their LLM call before the UI's next
    poll, and the streaming animation is never visible.
    """

    # Pre-emit: mark the stage as streaming before the first chunk arrives.
    initial = dict(step.detail or {})
    initial["crewai"] = {"enabled": True, "summary": "", "streaming": True}
    step.detail = initial
    run.updated_at = _now()
    upsert_run(run)

    def emit(partial: str) -> None:
        current = dict(step.detail or {})
        current["crewai"] = {
            "enabled": True,
            "summary": partial,
            "streaming": True,
        }
        step.detail = current
        run.updated_at = _now()
        upsert_run(run)

    return emit


def execute_run(run: WorkflowRun) -> WorkflowRun:
    resolved_terms = run.search_terms
    resolved_focus = run.focus

    # 1) Scanning
    step_scan = _start_step("scanning")
    run.steps.append(step_scan)
    upsert_run(run)

    scanned = search_sources(resolved_terms)
    scan_summary = summarize_stage(
        stage_name="Scanning Agent",
        objective="Collect weak-signal candidates from energy-related sources.",
        payload={"focus": resolved_focus, "hits": len(scanned)},
        on_chunk=_make_streaming_emitter(step_scan, run),
    )
    _finish_step(
        step_scan,
        {
            "focus": resolved_focus,
            "hits": len(scanned),
            "sample_sources": [item["source"].model_dump() for item in scanned[:5]],
            "crewai": {
                "enabled": scan_summary.used_crewai,
                "summary": scan_summary.text,
            },
        },
    )
    run.updated_at = _now()
    upsert_run(run)

    # 2) Assessment
    step_assess = _start_step("assessment")
    run.steps.append(step_assess)
    step_assess.detail = {"progress": {"classified": 0, "total": len(scanned)}}
    upsert_run(run)

    total = len(scanned)
    ordered: list[SignalCase | None] = [None] * total
    llm_count = 0
    heuristic_count = 0
    done = 0
    progress_lock = threading.Lock()

    # Precompute the cross-run URL history once (single state scan) and share the
    # read-only map with all workers, instead of each worker reloading + scanning
    # the whole store per case.
    url_history = build_url_history(exclude_run_id=run.run_id)

    # Classify candidates in parallel: each item is an independent blocking LLM
    # call, so a small thread pool turns N sequential round-trips into ~N/workers.
    # The progress_lock serializes the shared counters and the state.json write,
    # so the UI still polls a coherent "classified / total" as results land.
    with ThreadPoolExecutor(max_workers=settings.llm_max_workers) as pool:
        future_to_idx = {
            pool.submit(_classify_one, item, run, resolved_focus, url_history): i
            for i, item in enumerate(scanned)
        }
        for fut in as_completed(future_to_idx):
            i = future_to_idx[fut]
            case, src = fut.result()
            ordered[i] = case
            with progress_lock:
                if src == "llm":
                    llm_count += 1
                else:
                    heuristic_count += 1
                done += 1
                if done % 3 == 0 or done == total:
                    built = [c for c in ordered if c is not None]
                    step_assess.detail = {
                        "progress": {"classified": done, "total": total},
                        "llm_classified": llm_count,
                        "heuristic_classified": heuristic_count,
                        "signal_count": len([c for c in built if c.is_signal]),
                        "noise_count": len([c for c in built if not c.is_signal]),
                    }
                    run.updated_at = _now()
                    upsert_run(run)

    cases: list[SignalCase] = [c for c in ordered if c is not None]

    assess_summary = summarize_stage(
        stage_name="Assessment Agent",
        objective="Classify candidates into signal vs noise with rationale.",
        on_chunk=_make_streaming_emitter(step_assess, run),
        payload={
            "candidate_count": len(cases),
            "signal_count": len([c for c in cases if c.is_signal]),
            "noise_count": len([c for c in cases if not c.is_signal]),
            "llm_classified": llm_count,
            "heuristic_classified": heuristic_count,
        },
    )
    _finish_step(
        step_assess,
        {
            "candidate_count": len(cases),
            "signal_count": len([c for c in cases if c.is_signal]),
            "noise_count": len([c for c in cases if not c.is_signal]),
            "llm_classified": llm_count,
            "heuristic_classified": heuristic_count,
            "progress": {"classified": len(scanned), "total": len(scanned)},
            "crewai": {
                "enabled": assess_summary.used_crewai,
                "summary": assess_summary.text,
            },
        },
    )
    run.updated_at = _now()
    upsert_run(run)

    # 3) Expert validation – per-case LLM domain check
    step_expert = _start_step("energy_expert_validation")
    run.steps.append(step_expert)
    step_expert.detail = {"progress": {"validated": 0, "total": len(cases)}}
    upsert_run(run)

    expert_llm_count = 0
    expert_heuristic_count = 0
    domain_rejected_count = 0
    expert_done = 0
    expert_total = len(cases)
    expert_lock = threading.Lock()

    # Same parallel pattern as Assessment: each case is one blocking expert LLM
    # call. _validate_one mutates its own case in place; the lock guards only the
    # shared counters and the progress write.
    with ThreadPoolExecutor(max_workers=settings.llm_max_workers) as pool:
        futures = [pool.submit(_validate_one, case, resolved_focus) for case in cases]
        for fut in as_completed(futures):
            src = fut.result()
            with expert_lock:
                if src == "llm":
                    expert_llm_count += 1
                else:
                    expert_heuristic_count += 1
                expert_done += 1
                domain_rejected_count = len([c for c in cases if c.expert_valid is False])
                if expert_done % 3 == 0 or expert_done == expert_total:
                    step_expert.detail = {
                        "progress": {"validated": expert_done, "total": expert_total},
                        "llm_validated": expert_llm_count,
                        "heuristic_validated": expert_heuristic_count,
                        "domain_rejected": domain_rejected_count,
                        "validated_count": len([c for c in cases if c.validation_status == "validated"]),
                        "awaiting_review_count": len([c for c in cases if c.validation_status == "awaiting_review"]),
                        "rejected_count": len([c for c in cases if c.validation_status == "rejected"]),
                    }
                    run.updated_at = _now()
                    upsert_run(run)

    validated_count = len([c for c in cases if c.validation_status == "validated"])

    expert_summary = summarize_stage(
        stage_name="Energy Expert Agent",
        objective="Validate strategic relevance via merit-order, missing-money and Zieldreieck checks.",
        on_chunk=_make_streaming_emitter(step_expert, run),
        payload={
            "validated_count": validated_count,
            "awaiting_review_count": len([c for c in cases if c.validation_status == "awaiting_review"]),
            "rejected_count": len([c for c in cases if c.validation_status == "rejected"]),
            "domain_rejected": domain_rejected_count,
            "llm_validated": expert_llm_count,
            "heuristic_validated": expert_heuristic_count,
        },
    )
    _finish_step(
        step_expert,
        {
            "validated_count": validated_count,
            "awaiting_review_count": len([c for c in cases if c.validation_status == "awaiting_review"]),
            "rejected_count": len([c for c in cases if c.validation_status == "rejected"]),
            "domain_rejected": domain_rejected_count,
            "llm_validated": expert_llm_count,
            "heuristic_validated": expert_heuristic_count,
            "progress": {"validated": len(cases), "total": len(cases)},
            "crewai": {
                "enabled": expert_summary.used_crewai,
                "summary": expert_summary.text,
            },
        },
    )
    upsert_cases(cases)
    run.updated_at = _now()
    upsert_run(run)

    # HITL Gate: if any case needs human review, pause here.
    awaiting = [c for c in cases if c.validation_status == "awaiting_review"]
    if awaiting:
        run.status = "awaiting_review"
        run.updated_at = _now()
        run.summary = {
            "cases_total": len(cases),
            "signals": len([c for c in cases if c.is_signal]),
            "noise": len([c for c in cases if not c.is_signal]),
            "validated_signals": len([c for c in cases if c.validation_status == "validated"]),
            "awaiting_review": len(awaiting),
        }
        upsert_run(run)
        return run

    # 4) Scenario integration
    _run_scenario_step(run, cases)
    return run


def _run_scenario_step(run: WorkflowRun, cases: list[SignalCase]) -> None:
    """Append + execute the scenario integration step. Used by both the
    end-to-end run path and the HITL resume path."""

    step_scenario = _start_step("scenario_integration")
    run.steps.append(step_scenario)
    upsert_run(run)

    validated_cases = [c for c in cases if c.validation_status == "validated"]
    strategic_alerts = [
        {
            "case_id": c.case_id,
            "title": c.title,
            "keyword": c.keyword,
            "ansoff_level": c.ansoff_level,
            "confidence": c.confidence,
            "main_source": c.sources[0].url if c.sources else None,
        }
        for c in validated_cases[:10]
    ]

    scenario_summary = summarize_stage(
        stage_name="Scenario Agent",
        objective="Synthesize validated weak signals into strategic alerts.",
        on_chunk=_make_streaming_emitter(step_scenario, run),
        payload={"alerts": strategic_alerts[:5], "alert_count": len(strategic_alerts)},
    )
    _finish_step(
        step_scenario,
        {
            "alert_count": len(strategic_alerts),
            "alerts": strategic_alerts,
            "crewai": {
                "enabled": scenario_summary.used_crewai,
                "summary": scenario_summary.text,
            },
        },
    )

    # Suggest follow-up search terms based on validated cases.
    run.suggested_search_terms = suggest_search_terms(
        focus=run.focus,
        existing_terms=list(run.search_terms),
        validated_cases=[
            {
                "keyword": c.keyword,
                "title": c.title,
                "pestel_category": c.pestel_category,
                "ansoff_level": c.ansoff_level,
            }
            for c in validated_cases
        ],
    )

    run.status = "completed"
    run.updated_at = _now()
    run.summary = {
        "cases_total": len(cases),
        "signals": len([c for c in cases if c.is_signal]),
        "noise": len([c for c in cases if not c.is_signal]),
        "validated_signals": len(validated_cases),
        "strategic_alerts": len(strategic_alerts),
    }
    upsert_run(run)


def resume_run(run_id: str) -> WorkflowRun | None:
    """Resume a workflow that paused at the HITL gate. Loads the run + cases,
    runs only the scenario integration step. Returns None if the run cannot
    be resumed."""

    from app.data_store import get_run, list_cases

    run = get_run(run_id)
    if not run or run.status != "awaiting_review":
        return None

    cases = list_cases(run.run_id)
    run.status = "running"
    run.updated_at = _now()
    upsert_run(run)

    _run_scenario_step(run, cases)
    return run


def run_workflow(search_terms: list[str] | None = None, focus: str | None = None) -> WorkflowRun:
    run = prepare_run(search_terms=search_terms, focus=focus)
    try:
        return execute_run(run)
    except Exception as exc:
        run.status = "failed"
        run.updated_at = _now()
        run.summary = {**run.summary, "error": str(exc)[:300]}
        upsert_run(run)
        raise

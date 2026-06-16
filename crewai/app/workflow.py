from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from app.config import settings
from app.crew_layer import summarize_stage
from app.data_store import get_search_terms, upsert_cases, upsert_run
from app.models import SignalCase, SourceItem, WorkflowRun, WorkflowStep
from app.sources import search_sources


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
    return datetime.utcnow().isoformat() + "Z"


def _start_step(name: str) -> WorkflowStep:
    return WorkflowStep(name=name, status="running", started_at=_now(), detail={})


def _finish_step(step: WorkflowStep, detail: dict) -> WorkflowStep:
    step.status = "done"
    step.finished_at = _now()
    step.detail = detail
    return step


def _confidence(term: str, source: SourceItem) -> float:
    base = 0.42
    token_hits = sum(1 for token in _SIGNAL_TERMS if token in term.lower() or token in source.snippet.lower())
    score = base + token_hits * 0.07 + source.trust_score * 0.2
    return max(0.0, min(round(score, 2), 1.0))


def _ansoff_level(term: str) -> int:
    if "market" in term or "capacity" in term:
        return 3
    if "hydrogen" in term or "storage" in term:
        return 4
    if "grid" in term:
        return 2
    return 1


def run_workflow(search_terms: list[str] | None = None, focus: str | None = None) -> WorkflowRun:
    resolved_terms = search_terms or get_search_terms().search_terms
    resolved_focus = focus or settings.default_focus

    run = WorkflowRun(
        run_id=f"run_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}",
        created_at=_now(),
        updated_at=_now(),
        focus=resolved_focus,
        search_terms=resolved_terms,
        status="running",
        steps=[],
        summary={},
    )
    upsert_run(run)

    # 1) Scanning
    step_scan = _start_step("scanning")
    run.steps.append(step_scan)
    upsert_run(run)

    scanned = search_sources(resolved_terms)
    scan_summary = summarize_stage(
        stage_name="Scanning Agent",
        objective="Collect weak-signal candidates from energy-related sources.",
        payload={"focus": resolved_focus, "hits": len(scanned)},
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
    upsert_run(run)

    cases: list[SignalCase] = []
    for item in scanned:
        term = item["keyword"]
        source: SourceItem = item["source"]
        confidence = _confidence(term, source)
        is_signal = confidence >= 0.62
        rationale = (
            "Detected potential structural impact in policy, cost, or security dimensions "
            f"for keyword '{term}'."
        )
        case = SignalCase(
            case_id=f"case_{uuid4().hex[:10]}",
            run_id=run.run_id,
            keyword=term,
            title=source.title,
            rationale=rationale,
            confidence=confidence,
            is_signal=is_signal,
            ansoff_level=_ansoff_level(term),
            validation_status="pending",
            sources=[source],
        )
        cases.append(case)

    assess_summary = summarize_stage(
        stage_name="Assessment Agent",
        objective="Classify candidates into signal vs noise with rationale.",
        payload={
            "candidate_count": len(cases),
            "signal_count": len([c for c in cases if c.is_signal]),
            "noise_count": len([c for c in cases if not c.is_signal]),
        },
    )
    _finish_step(
        step_assess,
        {
            "candidate_count": len(cases),
            "signal_count": len([c for c in cases if c.is_signal]),
            "noise_count": len([c for c in cases if not c.is_signal]),
            "crewai": {
                "enabled": assess_summary.used_crewai,
                "summary": assess_summary.text,
            },
        },
    )
    run.updated_at = _now()
    upsert_run(run)

    # 3) Expert validation
    step_expert = _start_step("energy_expert_validation")
    run.steps.append(step_expert)
    upsert_run(run)

    validated_count = 0
    for case in cases:
        if case.is_signal and case.confidence >= 0.72:
            case.validation_status = "validated"
            case.expert_comment = "Consistent with strategic relevance for the energy transition portfolio."
            validated_count += 1
        elif case.is_signal:
            case.validation_status = "pending"
            case.expert_comment = "Potential signal, but requires human review due to medium confidence."
        else:
            case.validation_status = "rejected"
            case.expert_comment = "Classified as noise due to weak structural impact evidence."

    expert_summary = summarize_stage(
        stage_name="Energy Expert Agent",
        objective="Validate strategic relevance and assign confidence context.",
        payload={
            "validated_count": validated_count,
            "pending_review_count": len([c for c in cases if c.validation_status == "pending"]),
            "rejected_count": len([c for c in cases if c.validation_status == "rejected"]),
        },
    )
    _finish_step(
        step_expert,
        {
            "validated_count": validated_count,
            "pending_review_count": len([c for c in cases if c.validation_status == "pending"]),
            "rejected_count": len([c for c in cases if c.validation_status == "rejected"]),
            "crewai": {
                "enabled": expert_summary.used_crewai,
                "summary": expert_summary.text,
            },
        },
    )
    upsert_cases(cases)
    run.updated_at = _now()
    upsert_run(run)

    # 4) Scenario integration
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

    return run

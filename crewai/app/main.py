from __future__ import annotations

import threading
import traceback
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.crew_layer import probe_llm
from app.data_store import (
    clear_history,
    get_case,
    get_run,
    get_search_terms,
    has_active_run,
    list_cases,
    list_runs,
    set_search_terms,
    upsert_case,
    upsert_run,
)
from app.models import ReviewCaseRequest, StartWorkflowRequest, UpdateSearchTermsRequest
from app.workflow import execute_run, prepare_run, resume_run

app = FastAPI(title="CrewAI Foresight Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _now() -> str:
    # Timezone-aware UTC, formatted with a trailing "Z" to match the timestamps
    # produced in workflow.py (datetime.utcnow() is deprecated in 3.12+).
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "crewai-foresight-backend", "at": _now()}


@app.get("/llm/health")
def llm_health() -> dict:
    probe = probe_llm()
    return {
        "ok": probe.ok,
        "status": probe.status,
        "model": settings.llm_model,
        "api_key_present": bool(settings.llm_api_key),
        "detail": probe.detail,
        "at": _now(),
    }


@app.get("/config/search-terms")
def read_search_terms() -> dict:
    cfg = get_search_terms()
    return {"ok": True, "search_terms": cfg.search_terms}


@app.put("/config/search-terms")
def write_search_terms(payload: UpdateSearchTermsRequest) -> dict:
    if not payload.search_terms:
        raise HTTPException(status_code=400, detail="search_terms must not be empty")
    cfg = set_search_terms(payload.search_terms)
    return {"ok": True, "search_terms": cfg.search_terms}


def _background_execute(run_id: str) -> None:
    run = get_run(run_id)
    if run is None:
        return
    try:
        execute_run(run)
    except Exception:
        traceback.print_exc()
        latest = get_run(run_id) or run
        latest.status = "failed"
        latest.updated_at = _now()
        latest.summary = {**latest.summary, "error": "execution failed; see backend logs"}
        upsert_run(latest)


def _background_resume(run_id: str) -> None:
    try:
        resume_run(run_id)
    except Exception:
        traceback.print_exc()
        latest = get_run(run_id)
        if latest is None:
            return
        latest.status = "failed"
        latest.updated_at = _now()
        latest.summary = {**latest.summary, "error": "resume failed; see backend logs"}
        upsert_run(latest)


@app.post("/workflow/start")
def start_workflow(payload: StartWorkflowRequest) -> dict:
    # Only one workflow may execute at a time: concurrent runs would have
    # multiple background threads mutating the same flat-file store. (A run
    # paused for HITL review counts as inactive, so review never blocks a start.)
    if has_active_run():
        raise HTTPException(
            status_code=409,
            detail=(
                "Es läuft bereits ein Workflow. Warte, bis er abgeschlossen oder "
                "pausiert ist, bevor du einen neuen startest."
            ),
        )
    run = prepare_run(search_terms=payload.search_terms, focus=payload.focus)
    thread = threading.Thread(target=_background_execute, args=(run.run_id,), daemon=True)
    thread.start()
    return {
        "ok": True,
        "run": run.model_dump(),
        "cases": [],
    }


@app.post("/workflow/{run_id}/resume")
def resume_workflow(run_id: str) -> dict:
    run = get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    if run.status != "awaiting_review":
        raise HTTPException(
            status_code=409,
            detail=f"run is in status '{run.status}', not 'awaiting_review' - nothing to resume.",
        )
    pending = [c for c in list_cases(run_id) if c.validation_status == "awaiting_review"]
    if pending:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{len(pending)} cases still need human review. Mark each as signal "
                "(approve) or noise (reject) before resuming."
            ),
        )

    thread = threading.Thread(target=_background_resume, args=(run_id,), daemon=True)
    thread.start()
    return {"ok": True, "run_id": run_id, "status": "resuming"}


@app.delete("/workflow")
def clear_workflow_history(force: bool = Query(default=False)) -> dict:
    if has_active_run() and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                "Es gibt Runs im Status 'running'. Falls diese verwaist sind "
                "(z. B. nach uvicorn-Neustart), erneut mit ?force=true loeschen."
            ),
        )
    stats = clear_history()
    return {"ok": True, "forced": force, **stats}


@app.get("/workflow")
def list_workflow_runs(limit: int = Query(default=25, ge=1, le=100)) -> dict:
    runs = list_runs(limit=limit)
    return {
        "ok": True,
        "runs": [
            {
                "run_id": run.run_id,
                "created_at": run.created_at,
                "updated_at": run.updated_at,
                "status": run.status,
                "focus": run.focus,
                "search_terms": run.search_terms,
                "summary": run.summary,
                "step_count": len(run.steps),
            }
            for run in runs
        ],
    }


@app.get("/workflow/{run_id}")
def get_workflow(run_id: str) -> dict:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    cases = list_cases(run_id)
    return {
        "ok": True,
        "run": run.model_dump(),
        "cases": [case.model_dump() for case in cases],
    }


@app.get("/cases")
def get_cases(run_id: str | None = Query(default=None)) -> dict:
    cases = list_cases(run_id=run_id)
    return {"ok": True, "cases": [case.model_dump() for case in cases]}


@app.get("/cases/{case_id}")
def read_case(case_id: str) -> dict:
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    return {"ok": True, "case": case.model_dump()}


@app.put("/cases/{case_id}/review")
def review_case(case_id: str, payload: ReviewCaseRequest) -> dict:
    case = get_case(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")

    case.is_signal = payload.is_signal
    if payload.corrected_title:
        case.title = payload.corrected_title
    if payload.corrected_rationale:
        case.rationale = payload.corrected_rationale
    case.reviewer_comment = payload.comment
    case.reviewed_by = payload.reviewer
    case.reviewed_at = _now()

    # Human review is a decisive vote: signal => validated, noise => rejected.
    case.validation_status = "validated" if case.is_signal else "rejected"

    updated = upsert_case(case)
    return {"ok": True, "case": updated.model_dump()}

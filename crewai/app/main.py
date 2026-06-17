from __future__ import annotations

import threading
import traceback
from datetime import datetime

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
from app.workflow import execute_run, prepare_run

app = FastAPI(title="CrewAI Foresight Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "crewai-foresight-backend", "at": datetime.utcnow().isoformat() + "Z"}


@app.get("/llm/health")
def llm_health() -> dict:
    probe = probe_llm()
    return {
        "ok": probe.ok,
        "status": probe.status,
        "model": settings.llm_model,
        "api_key_present": bool(settings.llm_api_key),
        "detail": probe.detail,
        "at": datetime.utcnow().isoformat() + "Z",
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
    from app.data_store import get_run

    run = get_run(run_id)
    if run is None:
        return
    try:
        execute_run(run)
    except Exception:
        traceback.print_exc()
        latest = get_run(run_id) or run
        latest.status = "failed"
        latest.updated_at = datetime.utcnow().isoformat() + "Z"
        latest.summary = {**latest.summary, "error": "execution failed; see backend logs"}
        upsert_run(latest)


@app.post("/workflow/start")
def start_workflow(payload: StartWorkflowRequest) -> dict:
    run = prepare_run(search_terms=payload.search_terms, focus=payload.focus)
    thread = threading.Thread(target=_background_execute, args=(run.run_id,), daemon=True)
    thread.start()
    return {
        "ok": True,
        "run": run.model_dump(),
        "cases": [],
    }


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
    case.reviewed_at = datetime.utcnow().isoformat() + "Z"

    if case.is_signal and case.validation_status == "rejected":
        case.validation_status = "pending"
    if not case.is_signal:
        case.validation_status = "rejected"

    updated = upsert_case(case)
    return {"ok": True, "case": updated.model_dump()}

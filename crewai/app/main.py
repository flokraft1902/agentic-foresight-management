from __future__ import annotations

from datetime import datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.data_store import (
    get_case,
    get_run,
    get_search_terms,
    list_cases,
    set_search_terms,
    upsert_case,
)
from app.models import ReviewCaseRequest, StartWorkflowRequest, UpdateSearchTermsRequest
from app.workflow import run_workflow

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


@app.post("/workflow/start")
def start_workflow(payload: StartWorkflowRequest) -> dict:
    run = run_workflow(search_terms=payload.search_terms, focus=payload.focus)
    cases = list_cases(run.run_id)
    return {
        "ok": True,
        "run": run.model_dump(),
        "cases": [case.model_dump() for case in cases],
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

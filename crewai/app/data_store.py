from __future__ import annotations

import json
from pathlib import Path

from app.config import settings
from app.models import AppState, SearchTermsConfig, SignalCase, WorkflowRun


def _data_dir() -> Path:
    base = Path(settings.data_dir)
    base.mkdir(parents=True, exist_ok=True)
    return base


def _state_file() -> Path:
    return _data_dir() / "state.json"


def _default_terms() -> list[str]:
    return [term.strip() for term in settings.default_search_terms.split(",") if term.strip()]


def _default_state() -> AppState:
    return AppState(search_terms=_default_terms(), runs=[], cases=[])


def load_state() -> AppState:
    file_path = _state_file()
    if not file_path.exists():
        state = _default_state()
        save_state(state)
        return state
    raw = json.loads(file_path.read_text(encoding="utf-8"))
    return AppState.model_validate(raw)


def save_state(state: AppState) -> None:
    _state_file().write_text(state.model_dump_json(indent=2), encoding="utf-8")


def get_search_terms() -> SearchTermsConfig:
    state = load_state()
    return SearchTermsConfig(search_terms=state.search_terms)


def set_search_terms(terms: list[str]) -> SearchTermsConfig:
    normalized = [term.strip() for term in terms if term.strip()]
    state = load_state()
    state.search_terms = normalized
    save_state(state)
    return SearchTermsConfig(search_terms=normalized)


def upsert_run(run: WorkflowRun) -> None:
    state = load_state()
    idx = next((i for i, item in enumerate(state.runs) if item.run_id == run.run_id), None)
    if idx is None:
        state.runs.append(run)
    else:
        state.runs[idx] = run
    save_state(state)


def get_run(run_id: str) -> WorkflowRun | None:
    state = load_state()
    return next((item for item in state.runs if item.run_id == run_id), None)


def list_runs(limit: int = 25) -> list[WorkflowRun]:
    state = load_state()
    sorted_runs = sorted(state.runs, key=lambda r: r.created_at, reverse=True)
    return sorted_runs[:limit]


def has_active_run() -> bool:
    """Return True only if a workflow is genuinely mid-execution (not just
    paused for HITL review)."""
    state = load_state()
    return any(run.status == "running" for run in state.runs)


def clear_history() -> dict:
    state = load_state()
    deleted_runs = len(state.runs)
    deleted_cases = len(state.cases)
    state.runs = []
    state.cases = []
    save_state(state)
    return {"deleted_runs": deleted_runs, "deleted_cases": deleted_cases}


def list_cases(run_id: str | None = None) -> list[SignalCase]:
    state = load_state()
    all_cases = state.cases
    if run_id:
        all_cases = [item for item in all_cases if item.run_id == run_id]
    return all_cases


def get_case(case_id: str) -> SignalCase | None:
    state = load_state()
    return next((item for item in state.cases if item.case_id == case_id), None)


def upsert_cases(cases: list[SignalCase]) -> None:
    state = load_state()
    by_id = {item.case_id: item for item in state.cases}
    for case in cases:
        by_id[case.case_id] = case
    state.cases = list(by_id.values())
    save_state(state)


def upsert_case(case: SignalCase) -> SignalCase:
    state = load_state()
    idx = next((i for i, item in enumerate(state.cases) if item.case_id == case.case_id), None)
    if idx is None:
        state.cases.append(case)
    else:
        state.cases[idx] = case
    save_state(state)
    return case

"""Persistence layer: a single-file JSON store (state.json).

Holds the entire application state — search-term config, workflow runs and
signal cases — as one Pydantic-serialised document. Writes are atomic and
guarded by a process-wide reentrant lock so concurrent worker threads cannot
corrupt or clobber the file. A flat file is intentional for a self-hosted
seminar prototype; migrating to SQLite is noted as future work.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from app.config import settings
from app.models import AppState, SearchTermsConfig, SignalCase, WorkflowRun

# Guards every read-modify-write of state.json. Reentrant so a mutating helper
# can hold it across its load_state + save_state without deadlocking on the
# nested acquisitions inside those functions. Without this, concurrent threads
# (streaming emitter, parallel classifiers, a human review) race on the flat
# file and the last writer silently clobbers the others.
_LOCK = threading.RLock()


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
    with _LOCK:
        file_path = _state_file()
        if not file_path.exists():
            state = _default_state()
            save_state(state)
            return state
        raw = json.loads(file_path.read_text(encoding="utf-8"))
        return AppState.model_validate(raw)


def save_state(state: AppState) -> None:
    # Atomic write: serialize to a temp file in the same directory, then
    # os.replace() it over the target. replace() is atomic on the same
    # filesystem, so a crash mid-write can never leave a truncated/corrupt
    # state.json — readers see either the old file or the fully new one.
    with _LOCK:
        target = _state_file()
        tmp = target.with_name(target.name + f".tmp.{os.getpid()}")
        tmp.write_text(state.model_dump_json(indent=2), encoding="utf-8")
        os.replace(tmp, target)


def get_search_terms() -> SearchTermsConfig:
    state = load_state()
    return SearchTermsConfig(search_terms=state.search_terms)


def set_search_terms(terms: list[str]) -> SearchTermsConfig:
    normalized = [term.strip() for term in terms if term.strip()]
    with _LOCK:
        state = load_state()
        state.search_terms = normalized
        save_state(state)
    return SearchTermsConfig(search_terms=normalized)


def upsert_run(run: WorkflowRun) -> None:
    with _LOCK:
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


def lookup_url_history(url: str, exclude_run_id: str | None = None) -> tuple[str | None, str | None, int]:
    """Return (first_seen_run_id, first_seen_at, count_of_prior_runs) for a URL
    by scanning all cases. Counts each distinct run only once. Excludes the
    optionally given run so callers can ignore the run they are currently
    building."""
    state = load_state()
    runs_by_id = {r.run_id: r for r in state.runs}
    seen_run_ids: set[str] = set()
    for case in state.cases:
        if exclude_run_id and case.run_id == exclude_run_id:
            continue
        if any(src.url == url for src in case.sources):
            seen_run_ids.add(case.run_id)

    if not seen_run_ids:
        return None, None, 0

    earliest_run_id: str | None = None
    earliest_at: str | None = None
    for rid in seen_run_ids:
        run = runs_by_id.get(rid)
        if not run:
            continue
        if earliest_at is None or run.created_at < earliest_at:
            earliest_at = run.created_at
            earliest_run_id = run.run_id
    return earliest_run_id, earliest_at, len(seen_run_ids)


def build_url_history(exclude_run_id: str | None = None) -> dict[str, tuple[str, str, int]]:
    """Build the full URL → (first_seen_run_id, first_seen_at, prior_run_count)
    map in a single state scan.

    This replaces calling lookup_url_history() once per case (each of which
    loaded + scanned the entire state), which was O(cases_in_run × total_cases)
    and — under the parallel classifier — meant every worker reloaded the whole
    store. The returned map is read-only, so it can be shared across threads.
    Mirrors lookup_url_history's semantics: each distinct run counts once and
    the earliest run (by created_at) is the first sighting."""
    with _LOCK:
        state = load_state()
        runs_by_id = {r.run_id: r for r in state.runs}
        url_runs: dict[str, set[str]] = {}
        for case in state.cases:
            if exclude_run_id and case.run_id == exclude_run_id:
                continue
            for src in case.sources:
                url_runs.setdefault(src.url, set()).add(case.run_id)

    history: dict[str, tuple[str, str, int]] = {}
    for url, run_ids in url_runs.items():
        earliest_id: str | None = None
        earliest_at: str | None = None
        for rid in run_ids:
            run = runs_by_id.get(rid)
            if not run:
                continue
            if earliest_at is None or run.created_at < earliest_at:
                earliest_at = run.created_at
                earliest_id = run.run_id
        if earliest_id is not None and earliest_at is not None:
            history[url] = (earliest_id, earliest_at, len(run_ids))
    return history


def has_active_run() -> bool:
    """Return True only if a workflow is genuinely mid-execution (not just
    paused for HITL review)."""
    state = load_state()
    return any(run.status == "running" for run in state.runs)


def clear_history() -> dict:
    with _LOCK:
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
    with _LOCK:
        state = load_state()
        by_id = {item.case_id: item for item in state.cases}
        for case in cases:
            by_id[case.case_id] = case
        state.cases = list(by_id.values())
        save_state(state)


def upsert_case(case: SignalCase) -> SignalCase:
    with _LOCK:
        state = load_state()
        idx = next((i for i, item in enumerate(state.cases) if item.case_id == case.case_id), None)
        if idx is None:
            state.cases.append(case)
        else:
            state.cases[idx] = case
        save_state(state)
    return case

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


PestelCategory = Literal["P", "E", "S", "T", "En", "L"]
ZieldreieckDimension = Literal["wirtschaftlichkeit", "versorgungssicherheit", "umweltvertraeglichkeit"]
ValidationStatus = Literal["pending", "awaiting_review", "validated", "rejected"]
RunStatus = Literal["running", "awaiting_review", "completed", "failed"]
SystemicImpact = Literal["HOCH", "MITTEL", "GERING"]


class SourceItem(BaseModel):
    title: str
    url: str
    snippet: str
    published_at: str | None = None
    trust_score: float = Field(default=0.6, ge=0.0, le=1.0)


class SignalCase(BaseModel):
    case_id: str
    run_id: str
    keyword: str
    title: str
    rationale: str
    confidence: float = Field(ge=0.0, le=1.0)
    is_signal: bool
    ansoff_level: int = Field(default=1, ge=1, le=4)
    pestel_category: PestelCategory | None = None
    zieldreieck_dimensions: list[ZieldreieckDimension] = Field(default_factory=list)
    validation_status: ValidationStatus = "pending"
    expert_comment: str | None = None
    expert_valid: bool | None = None
    systemic_impact: SystemicImpact | None = None
    time_horizon: str | None = None
    zieldreieck_impact: dict[str, str] = Field(default_factory=dict)
    reviewer_comment: str | None = None
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    sources: list[SourceItem] = Field(default_factory=list)


class WorkflowStep(BaseModel):
    name: str
    status: Literal["pending", "running", "done", "failed"] = "pending"
    started_at: str | None = None
    finished_at: str | None = None
    detail: dict = Field(default_factory=dict)


class WorkflowRun(BaseModel):
    run_id: str
    created_at: str
    updated_at: str
    focus: str
    search_terms: list[str]
    status: RunStatus
    steps: list[WorkflowStep]
    summary: dict = Field(default_factory=dict)


class StartWorkflowRequest(BaseModel):
    search_terms: list[str] | None = None
    focus: str | None = None


class UpdateSearchTermsRequest(BaseModel):
    search_terms: list[str]


class ReviewCaseRequest(BaseModel):
    is_signal: bool
    comment: str | None = None
    corrected_title: str | None = None
    corrected_rationale: str | None = None
    reviewer: str = "human.reviewer"


class SearchTermsConfig(BaseModel):
    search_terms: list[str]


class AppState(BaseModel):
    search_terms: list[str]
    runs: list[WorkflowRun]
    cases: list[SignalCase]


class ApiResponse(BaseModel):
    ok: bool = True
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")

export interface SourceItem {
  title: string;
  url: string;
  snippet: string;
  published_at?: string;
  trust_score: number;
}

export type PestelCategory = "P" | "E" | "S" | "T" | "En" | "L";
export type ZieldreieckDimension =
  | "wirtschaftlichkeit"
  | "versorgungssicherheit"
  | "umweltvertraeglichkeit";
export type ValidationStatus = "pending" | "awaiting_review" | "validated" | "rejected";

export interface SignalCase {
  case_id: string;
  run_id: string;
  keyword: string;
  title: string;
  rationale: string;
  confidence: number;
  is_signal: boolean;
  ansoff_level: number;
  pestel_category?: PestelCategory | null;
  zieldreieck_dimensions?: ZieldreieckDimension[];
  validation_status: ValidationStatus;
  expert_comment?: string;
  expert_valid?: boolean | null;
  systemic_impact?: "HOCH" | "MITTEL" | "GERING" | null;
  time_horizon?: string | null;
  zieldreieck_impact?: Record<string, string>;
  reviewer_comment?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  sources: SourceItem[];
}

export interface WorkflowStep {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  started_at?: string;
  finished_at?: string;
  detail: Record<string, unknown>;
}

export type RunStatus = "running" | "awaiting_review" | "completed" | "failed";

export interface WorkflowRun {
  run_id: string;
  created_at: string;
  updated_at: string;
  focus: string;
  search_terms: string[];
  status: RunStatus;
  steps: WorkflowStep[];
  summary: Record<string, number>;
}

export interface WorkflowResponse {
  ok: boolean;
  run: WorkflowRun;
  cases: SignalCase[];
}

export interface RunSummary {
  run_id: string;
  created_at: string;
  updated_at: string;
  status: WorkflowRun["status"];
  focus: string;
  search_terms: string[];
  summary: Record<string, number | string>;
  step_count: number;
}

export interface RunListResponse {
  ok: boolean;
  runs: RunSummary[];
}

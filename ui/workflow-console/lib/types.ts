export interface SourceItem {
  title: string;
  url: string;
  snippet: string;
  published_at?: string;
  trust_score: number;
}

export interface SignalCase {
  case_id: string;
  run_id: string;
  keyword: string;
  title: string;
  rationale: string;
  confidence: number;
  is_signal: boolean;
  ansoff_level: number;
  validation_status: "pending" | "validated" | "rejected";
  expert_comment?: string;
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

export interface WorkflowRun {
  run_id: string;
  created_at: string;
  updated_at: string;
  focus: string;
  search_terms: string[];
  status: "running" | "completed" | "failed";
  steps: WorkflowStep[];
  summary: Record<string, number>;
}

export interface WorkflowResponse {
  ok: boolean;
  run: WorkflowRun;
  cases: SignalCase[];
}

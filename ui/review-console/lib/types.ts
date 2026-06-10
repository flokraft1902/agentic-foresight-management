export type ReviewStatus = "pending" | "approved" | "corrected" | "rejected";

export type ReviewDecision = "approve" | "correct" | "reject";

export interface ReasoningFields {
  claim: string;
  evidence: string[];
  counterpoints: string[];
  uncertainty: "low" | "medium" | "high";
  confidence: number;
  policy_checks: Record<string, boolean>;
}

export interface ReviewCase {
  caseId: string;
  runId: string;
  stepId: string;
  agentName: string;
  createdAt: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
  reviewer?: string;
  reviewComment?: string;
  callbackUrl?: string;
  payload: Record<string, unknown>;
  decision: Record<string, unknown>;
  reasoningFields: ReasoningFields;
  sources: Array<{
    title: string;
    url: string;
    publishedAt?: string;
    trustScore?: number;
  }>;
}

export interface AuditEvent {
  id: string;
  at: string;
  caseId: string;
  action: "intake" | "approve" | "correct" | "reject";
  reviewer?: string;
  comment?: string;
  diff?: Record<string, unknown>;
}

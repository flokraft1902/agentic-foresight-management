import type { WorkflowStep } from "./types";

export function statusPillClass(status: string): string {
  if (status === "done" || status === "completed" || status === "validated") return "pill ok";
  if (status === "running" || status === "pending" || status === "awaiting_review") return "pill warn";
  if (status === "failed" || status === "rejected") return "pill bad";
  return "pill neutral";
}

export function formatTime(iso?: string): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "–";
  }
}

export function stepCrewSummary(step: WorkflowStep): string | null {
  const crewai = (step.detail as { crewai?: { summary?: string } }).crewai;
  return crewai?.summary || null;
}

export function stepUsedCrewai(step: WorkflowStep): boolean | null {
  const crewai = (step.detail as { crewai?: { enabled?: boolean } }).crewai;
  if (crewai === undefined) return null;
  return crewai.enabled === true;
}

export function stepIsStreaming(step: WorkflowStep): boolean {
  const crewai = (step.detail as { crewai?: { streaming?: boolean } }).crewai;
  return crewai?.streaming === true && step.status !== "done";
}

export interface StepProgress {
  label: string;
  done: number;
  total: number;
  llm: number | null;
  heuristic: number | null;
  extras: { label: string; count: number; tone: "ok" | "warn" | "neutral" | "bad" }[];
}

export function stepProgressInfo(step: WorkflowStep): StepProgress | null {
  const d = step.detail as Record<string, unknown>;
  if (!d) return null;
  const prog = d.progress as
    | { classified?: number; validated?: number; total?: number }
    | undefined;

  if (prog?.classified !== undefined || d.llm_classified !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.signal_count === "number")
      extras.push({ label: "Signale", count: d.signal_count, tone: "neutral" });
    if (typeof d.noise_count === "number")
      extras.push({ label: "Noise", count: d.noise_count, tone: "neutral" });
    return {
      label: "Klassifiziert",
      done: prog?.classified ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_classified === "number" ? d.llm_classified : null,
      heuristic: typeof d.heuristic_classified === "number" ? d.heuristic_classified : null,
      extras,
    };
  }

  if (prog?.validated !== undefined || d.llm_validated !== undefined) {
    const extras: StepProgress["extras"] = [];
    if (typeof d.validated_count === "number")
      extras.push({ label: "Validiert", count: d.validated_count, tone: "ok" });
    if (typeof d.awaiting_review_count === "number" && d.awaiting_review_count > 0)
      extras.push({ label: "Review nötig", count: d.awaiting_review_count, tone: "warn" });
    if (typeof d.rejected_count === "number" && d.rejected_count > 0)
      extras.push({ label: "Rejected", count: d.rejected_count, tone: "neutral" });
    if (typeof d.domain_rejected === "number" && d.domain_rejected > 0)
      extras.push({ label: "Domain-rejected", count: d.domain_rejected, tone: "bad" });
    return {
      label: "Validiert",
      done: prog?.validated ?? 0,
      total: prog?.total ?? 0,
      llm: typeof d.llm_validated === "number" ? d.llm_validated : null,
      heuristic: typeof d.heuristic_validated === "number" ? d.heuristic_validated : null,
      extras,
    };
  }

  return null;
}

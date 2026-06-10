import { NextResponse } from "next/server";
import { appendAuditEvent, newId, nowIso, upsertCase } from "@/lib/store";
import type { ReasoningFields, ReviewCase } from "@/lib/types";

function assertReasoning(value: unknown): ReasoningFields {
  if (!value || typeof value !== "object") {
    throw new Error("reasoningFields missing");
  }
  const candidate = value as Partial<ReasoningFields>;
  if (!candidate.claim || !Array.isArray(candidate.evidence) || !Array.isArray(candidate.counterpoints)) {
    throw new Error("reasoningFields structure invalid");
  }

  return {
    claim: candidate.claim,
    evidence: candidate.evidence,
    counterpoints: candidate.counterpoints,
    uncertainty: candidate.uncertainty || "medium",
    confidence: Number(candidate.confidence ?? 0.5),
    policy_checks: candidate.policy_checks || {},
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const createdAt = nowIso();
    const caseId = body.caseId || newId("case");

    const entry: ReviewCase = {
      caseId,
      runId: body.runId || "unknown-run",
      stepId: body.stepId || "unknown-step",
      agentName: body.agentName || "unknown-agent",
      createdAt,
      updatedAt: createdAt,
      reviewStatus: "pending",
      callbackUrl: body.callbackUrl,
      payload: body.payload || {},
      decision: body.decision || {},
      reasoningFields: assertReasoning(body.reasoningFields),
      sources: Array.isArray(body.sources) ? body.sources : [],
    };

    await upsertCase(entry);
    await appendAuditEvent({
      id: newId("audit"),
      at: nowIso(),
      caseId,
      action: "intake",
    });

    return NextResponse.json({ ok: true, caseId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}

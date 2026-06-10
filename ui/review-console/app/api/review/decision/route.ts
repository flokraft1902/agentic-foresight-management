import { NextResponse } from "next/server";
import { applyDecision, getCaseById } from "@/lib/store";
import type { ReviewDecision } from "@/lib/types";

function isDecision(value: unknown): value is ReviewDecision {
  return value === "approve" || value === "correct" || value === "reject";
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!isDecision(body.decision)) {
      return NextResponse.json({ error: "decision must be approve|correct|reject" }, { status: 400 });
    }

    if (!body.caseId || !body.reviewer) {
      return NextResponse.json({ error: "caseId and reviewer are required" }, { status: 400 });
    }

    const updated = await applyDecision({
      caseId: body.caseId,
      decision: body.decision,
      reviewer: body.reviewer,
      comment: body.comment,
      correctedDecision: body.correctedDecision,
    });

    const callbackTarget = body.callbackUrl || updated.callbackUrl || process.env.N8N_REVIEW_CALLBACK_URL;
    if (callbackTarget) {
      await fetch(callbackTarget, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: updated.caseId,
          runId: updated.runId,
          stepId: updated.stepId,
          reviewStatus: updated.reviewStatus,
          reviewer: updated.reviewer,
          reviewComment: updated.reviewComment,
          decision: updated.decision,
          updatedAt: updated.updatedAt,
        }),
      });
    }

    return NextResponse.json({ ok: true, item: updated });
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

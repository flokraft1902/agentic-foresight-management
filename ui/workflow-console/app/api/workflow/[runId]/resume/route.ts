import { NextResponse } from "next/server";
import { backendFetch } from "../../../../../lib/backend";

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const response = await backendFetch(`/workflow/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

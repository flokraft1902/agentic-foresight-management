import { NextResponse } from "next/server";
import { backendFetch } from "../../../../lib/backend";

export async function GET(_: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const response = await backendFetch(`/workflow/${runId}`, { method: "GET" });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

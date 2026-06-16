import { NextResponse } from "next/server";
import { backendFetch } from "../../../../../lib/backend";

export async function PUT(req: Request, context: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await context.params;
  const body = await req.json();

  const response = await backendFetch(`/cases/${caseId}/review`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

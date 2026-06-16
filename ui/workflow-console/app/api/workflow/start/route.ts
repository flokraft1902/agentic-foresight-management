import { NextResponse } from "next/server";
import { backendFetch } from "../../../../lib/backend";

export async function POST(req: Request) {
  const body = await req.json();
  const response = await backendFetch("/workflow/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

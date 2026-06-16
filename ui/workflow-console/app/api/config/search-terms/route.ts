import { NextResponse } from "next/server";
import { backendFetch } from "../../../../lib/backend";

export async function GET() {
  const response = await backendFetch("/config/search-terms", { method: "GET" });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const response = await backendFetch("/config/search-terms", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

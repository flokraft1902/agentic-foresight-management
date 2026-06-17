import { NextResponse } from "next/server";
import { backendFetch } from "../../../lib/backend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "25";
  const response = await backendFetch(`/workflow?limit=${encodeURIComponent(limit)}`);
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "true" ? "?force=true" : "";
  const response = await backendFetch(`/workflow${force}`, { method: "DELETE" });
  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}

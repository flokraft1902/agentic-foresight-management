import { NextResponse } from "next/server";
import { backendFetch } from "../../../lib/backend";

export async function GET() {
  try {
    const response = await backendFetch("/llm/health");
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "backend_unreachable",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}

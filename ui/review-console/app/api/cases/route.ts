import { NextResponse } from "next/server";
import { getAllCases } from "@/lib/store";

export async function GET() {
  const cases = await getAllCases();
  return NextResponse.json({ items: cases, count: cases.length });
}

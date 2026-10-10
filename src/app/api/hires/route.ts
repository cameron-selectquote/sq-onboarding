import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** GET /api/hires — list all hires. */
export async function GET() {
  const { repo } = await getServices();
  const hires = await repo.hires.list();
  return NextResponse.json({ hires });
}

import { NextResponse } from "next/server";

/** GET /api/health — unauthenticated liveness check (deploy smoke test). */
export function GET() {
  return NextResponse.json({ ok: true });
}

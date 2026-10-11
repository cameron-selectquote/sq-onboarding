import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

export const runtime = "nodejs";

/** GET /api/hires/:id/offboard — read-only reclaim preview (safe). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { offboarding } = await getServices();
  try {
    return NextResponse.json(await offboarding.preview(id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/**
 * POST /api/hires/:id/offboard — DESTRUCTIVE. Revokes seats + returns assets.
 * Requires explicit `?confirm=true` so it can't fire by accident.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const confirm = new URL(req.url).searchParams.get("confirm") === "true";
  if (!confirm) {
    return NextResponse.json(
      { error: "Offboarding is destructive. Pass ?confirm=true to proceed." },
      { status: 400 },
    );
  }
  const { offboarding } = await getServices();
  try {
    return NextResponse.json(await offboarding.execute(id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

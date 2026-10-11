import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * POST /api/licenses — assign a new seat to an existing hire.
 *
 * Body: { hireId, appId }. Creates an active license, writes the recurring
 * ledger entry, and bumps the IT budget. Returns 409 when the app's owned-seat
 * pool is exhausted, 400 for missing/unknown hire or app.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    hireId?: string;
    appId?: string;
  };

  if (!body.hireId || !body.appId) {
    return NextResponse.json(
      { error: "hireId and appId are required" },
      { status: 400 },
    );
  }

  const { licenses } = await getServices();
  try {
    const license = await licenses.assign(body.hireId, body.appId);
    return NextResponse.json({ license }, { status: 201 });
  } catch (err) {
    // Identify the out-of-capacity case by its stable `code`, not instanceof,
    // which is unreliable across Next.js bundle boundaries.
    const outOfSeats = (err as { code?: string }).code === "no_seats_available";
    const status = outOfSeats ? 409 : 400;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

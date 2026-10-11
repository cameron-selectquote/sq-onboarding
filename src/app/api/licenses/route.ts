import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * POST /api/licenses — assign a new seat to an existing hire.
 *
 * Body: { hireId, appId }. Creates an active license, writes the recurring
 * ledger entry, and bumps the IT budget. Returns 400 for a missing/unknown
 * hire or app.
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
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

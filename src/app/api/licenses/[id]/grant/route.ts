import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** POST /api/licenses/:id/grant — grant a seat, write ledger entry, bump budget. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { licenses } = await getServices();
  try {
    const license = await licenses.grant(id);
    return NextResponse.json({ license });
  } catch (err) {
    // Full pool → 409 (the license stays `requested`); other errors → 400.
    const outOfSeats = (err as { code?: string }).code === "no_seats_available";
    return NextResponse.json(
      { error: (err as Error).message },
      { status: outOfSeats ? 409 : 400 },
    );
  }
}

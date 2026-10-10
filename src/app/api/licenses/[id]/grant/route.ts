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
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}

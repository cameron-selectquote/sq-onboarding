import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** POST /api/assets/:id/return — mark an asset returned, credit residual value. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { assets } = await getServices();
  try {
    const asset = await assets.returnAsset(id);
    return NextResponse.json({ asset });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}

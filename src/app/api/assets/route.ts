import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { assetsOnHand } from "@/lib/finance";

/** GET /api/assets — inventory list + on-hand count. */
export async function GET() {
  const { repo } = await getServices();
  const assets = await repo.assets.list();
  return NextResponse.json({ assets, onHand: assetsOnHand(assets) });
}

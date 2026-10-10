import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** POST /api/pos — raise a PO: one-time ledger entry + provision an asset. */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    assetCatalogId?: string;
    hireId?: string;
    serialTag?: string;
  };

  if (!body.assetCatalogId || !body.hireId || !body.serialTag) {
    return NextResponse.json(
      { error: "assetCatalogId, hireId and serialTag are required" },
      { status: 400 },
    );
  }

  const { assets } = await getServices();
  try {
    const asset = await assets.raisePurchaseOrder({
      assetCatalogId: body.assetCatalogId,
      hireId: body.hireId,
      serialTag: body.serialTag,
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}

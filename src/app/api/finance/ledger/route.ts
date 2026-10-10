import { NextResponse } from "next/server";
import { getLedgerFeed, LEDGER_FEED_LIMIT } from "@/server/queries";

/**
 * GET /api/finance/ledger — the live ledger feed: entries newest-first,
 * hire-name enriched, capped. Optional `?limit=N` overrides the default cap.
 */
export async function GET(req: Request) {
  const limitParam = new URL(req.url).searchParams.get("limit");
  const parsed = limitParam === null ? NaN : Number(limitParam);
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : LEDGER_FEED_LIMIT;

  return NextResponse.json(await getLedgerFeed(limit));
}

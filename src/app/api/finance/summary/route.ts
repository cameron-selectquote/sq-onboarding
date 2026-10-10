import { NextResponse } from "next/server";
import { getFinanceSummary } from "@/server/queries";

/** GET /api/finance/summary — cost-per-hire inputs, burn, reclaimable, budgets. */
export async function GET() {
  return NextResponse.json(await getFinanceSummary());
}

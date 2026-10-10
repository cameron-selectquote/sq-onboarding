import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { financeSummary } from "@/lib/finance";

/** GET /api/finance/summary — cost-per-hire inputs, burn, reclaimable, budgets. */
export async function GET() {
  const { repo } = await getServices();

  const [licenses, apps, assets, assetCatalog, ledgerEntries, budgets] =
    await Promise.all([
      repo.licenses.list(),
      repo.appCatalog.list(),
      repo.assets.list(),
      repo.assetCatalog.list(),
      repo.ledgerEntries.list(),
      repo.budgets.list(),
    ]);

  const summary = financeSummary({
    licenses,
    apps,
    assets,
    assetCatalog,
    ledgerEntries,
    budgets,
  });

  return NextResponse.json({ summary, budgets });
}

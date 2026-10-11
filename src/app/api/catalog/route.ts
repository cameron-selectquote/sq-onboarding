import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { seatPools } from "@/lib/seats";

/**
 * GET /api/catalog — app catalog, asset catalog, and role templates.
 * Feeds the import form (roles + apps), license names, and the PO form.
 * `pools` reports owned/assigned/available seats per app.
 */
export async function GET() {
  const { repo } = await getServices();
  const [apps, assetCatalog, templates, licenses] = await Promise.all([
    repo.appCatalog.list(),
    repo.assetCatalog.list(),
    repo.templates.list(),
    repo.licenses.list(),
  ]);
  const pools = seatPools(apps, licenses);
  return NextResponse.json({ apps, assetCatalog, templates, pools });
}

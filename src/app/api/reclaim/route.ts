import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { buildReclaimReport } from "@/lib/reclaim";
import { OFFBOARDING_COHORT } from "@/data/seed";

/** GET /api/reclaim — reclaimable license + asset flags and a dollar total. */
export async function GET() {
  const { repo } = await getServices();

  const [licenses, apps, assets, assetCatalog, hires] = await Promise.all([
    repo.licenses.list(),
    repo.appCatalog.list(),
    repo.assets.list(),
    repo.assetCatalog.list(),
    repo.hires.list(),
  ]);

  const offboardingHireIds = new Set(
    hires.filter((h) => h.cohort === OFFBOARDING_COHORT).map((h) => h.id),
  );

  const report = buildReclaimReport({
    licenses,
    apps,
    assets,
    assetCatalog,
    offboardingHireIds,
  });

  return NextResponse.json(report);
}

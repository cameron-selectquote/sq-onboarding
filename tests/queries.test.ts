/**
 * Presenter-level reconciliation guard.
 *
 * getFinanceSummary() (behind GET /api/finance/summary) and getReclaimQueue()
 * (behind the overview tile, the reclaim page, and GET /api/reclaim) must report
 * the same reclaimable quantities, sourced from the one reclaim engine
 * (buildReclaimReport). This test fails if the two surfaces ever diverge, or if
 * the two units (recurring $/mo vs one-time asset $) get summed.
 */

// Use an ephemeral in-memory store so the seed loads fresh for this run and
// nothing touches the on-disk dev DB. Must be set before the store resolves
// its DB path (it does so lazily on first getServices()).
process.env.PROVISION_DB_PATH = ":memory:";

import { getFinanceSummary, getReclaimQueue } from "@/server/queries";
import { getServices } from "@/server/store";
import { buildReclaimReport } from "@/lib/reclaim";
import { OFFBOARDING_COHORT } from "@/data/seed";

describe("getFinanceSummary / getReclaimQueue reconciliation", () => {
  it("summary reclaim figures equal the reclaim queue totals (same engine)", async () => {
    const [{ summary }, queue] = await Promise.all([
      getFinanceSummary(),
      getReclaimQueue(),
    ]);

    // Recurring is status-based and time-independent -> exact match.
    expect(summary.reclaimableRecurringMonthly).toBe(queue.monthly);
    // One-time residual depends on asOf=now; the two presenters each run the
    // engine at their own instant, so allow sub-cent clock drift. A real
    // divergence (disjoint asset sets) would differ by whole dollars.
    expect(summary.reclaimableOneTimeAsset).toBeCloseTo(queue.oneTimeAsset, 2);
  });

  it("the reclaim queue totals equal buildReclaimReport directly", async () => {
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

    const queue = await getReclaimQueue();
    expect(queue.monthly).toBe(report.recurringMonthly);
    // Residual is time-dependent (asOf=now); the queue and this direct report
    // run at slightly different instants, so allow sub-cent clock drift.
    expect(queue.oneTimeAsset).toBeCloseTo(report.oneTimeAssetResidual, 2);

    // Both reclaim units are present and strictly separate — never summed.
    expect(report.recurringMonthly).toBeGreaterThan(0);
    expect(report.oneTimeAssetResidual).toBeGreaterThan(0);
  });
});

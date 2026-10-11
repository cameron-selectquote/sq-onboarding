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

import { filterQueueForInFlight, getFinanceSummary, getReclaimJobs, getReclaimQueue } from "@/server/queries";
import type { QueueRow } from "@/server/queries";
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

describe("getReclaimJobs (IT reclaim tab source)", () => {
  it("lists both pending and reclaiming jobs as open (the tab list + badge count)", async () => {
    const { repo, reclaimTasks } = await getServices();
    // Two active seats become two open jobs; start one so a 'reclaiming' job
    // also appears — the Reclaim tab shows both, undistinguished, and the badge
    // counts pending + reclaiming.
    const [a, b] = await repo.licenses.where((l) => l.status === "active");
    expect(a && b).toBeTruthy();

    const before = (await getReclaimJobs()).jobs.length;

    const jobA = await reclaimTasks.open(a!.id, "it");
    const jobB = await reclaimTasks.open(b!.id, "it");
    await reclaimTasks.start(jobB.id); // -> 'reclaiming'

    const { jobs } = await getReclaimJobs();
    expect(jobs.length).toBe(before + 2);

    const mine = jobs.filter((j) => j.taskId === jobA.id || j.taskId === jobB.id);
    expect(mine.map((j) => j.status).sort()).toEqual(["pending", "reclaiming"]);
  });
});

describe("filterQueueForInFlight (finance queue presenter)", () => {
  const row = (
    key: string,
    seats: Array<{ licenseId: string; monthly: number }>,
  ): QueueRow => ({
    key,
    reason: "idle",
    what: key,
    why: "test",
    licenseIds: seats.map((s) => s.licenseId),
    monthly: seats.reduce((acc, s) => acc + s.monthly, 0),
    seats: seats.map((s) => ({
      licenseId: s.licenseId,
      hireName: null,
      app: "GitHub",
      monthly: s.monthly,
      detail: "test",
    })),
  });

  it("returns rows unchanged when nothing is in flight", () => {
    const rows = [row("r1", [{ licenseId: "l1", monthly: 10 }])];
    expect(filterQueueForInFlight(rows, new Set())).toBe(rows);
  });

  it("drops a seat with an open job from the actionable rows", () => {
    const rows = [row("r1", [{ licenseId: "l1", monthly: 10 }])];
    const out = filterQueueForInFlight(rows, new Set(["l1"]));
    // In-flight seat is gone from the clickable queue...
    expect(out).toHaveLength(0);
    // ...but we never recomputed or exposed a recoverable total here: the
    // banner/breakdown still read the unchanged report, which keeps l1's $/mo.
    expect(rows[0]!.monthly).toBe(10);
  });

  it("keeps the remaining seats of a partially in-flight row and recomputes its total", () => {
    const rows = [
      row("r1", [
        { licenseId: "l1", monthly: 10 },
        { licenseId: "l2", monthly: 7 },
      ]),
    ];
    const out = filterQueueForInFlight(rows, new Set(["l1"]));
    expect(out).toHaveLength(1);
    expect(out[0]!.licenseIds).toEqual(["l2"]);
    expect(out[0]!.seats.map((s) => s.licenseId)).toEqual(["l2"]);
    expect(out[0]!.monthly).toBe(7);
  });
});

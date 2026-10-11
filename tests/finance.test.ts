import {
  assetsOnHand,
  avgCostPerSpendingHire,
  budgetBurnDown,
  burnDelta,
  costPerHire,
  cumulativeRecurringBurn,
  financeSummary,
  isOverspent,
  monthlyCost,
  monthlySpend,
  monthOverMonth,
  projectedRunRate,
  yearOverYear,
  recurringAddedSince,
  recurringMonthlyBurn,
  reclaimable,
  residualValue,
} from "@/lib/finance";
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  LedgerEntry,
  License,
} from "@/lib/types";

const apps: AppCatalogItem[] = [
  { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly", seatsOwned: 100, seatsInUseBaseline: 0 },
  { id: "zoom", name: "Zoom", category: "comms", costPerSeat: 120, billing: "annual", seatsOwned: 100, seatsInUseBaseline: 0 },
];

const assetCatalog: AssetCatalogItem[] = [
  { id: "mbp", name: "MBP", category: "laptop", standardCost: 2400, depreciationMonths: 24 },
];

describe("monthlyCost", () => {
  it("passes monthly through and divides annual by 12", () => {
    expect(monthlyCost(21, "monthly")).toBe(21);
    expect(monthlyCost(120, "annual")).toBe(10);
  });
});

describe("costPerHire", () => {
  it("sums only the hire's ledger entries", () => {
    const entries: LedgerEntry[] = [
      { id: "1", hireId: "h1", type: "fee", label: "a", amount: 100, costType: "one_time", refTable: null, refId: null, createdAt: "" },
      { id: "2", hireId: "h1", type: "fee", label: "b", amount: 25, costType: "recurring", refTable: null, refId: null, createdAt: "" },
      { id: "3", hireId: "h2", type: "fee", label: "c", amount: 999, costType: "one_time", refTable: null, refId: null, createdAt: "" },
    ];
    expect(costPerHire(entries, "h1")).toBe(125);
  });
});

describe("recurringMonthlyBurn", () => {
  it("counts only active licenses, normalized to monthly", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: null },
      { id: "l2", hireId: "h1", appId: "zoom", status: "active", grantedAt: null, lastUsedAt: null },
      { id: "l3", hireId: "h2", appId: "github", status: "revoked", grantedAt: null, lastUsedAt: null },
    ];
    // 21 (github monthly) + 10 (zoom annual/12)
    expect(recurringMonthlyBurn(licenses, apps)).toBe(31);
  });
});

describe("projectedRunRate", () => {
  it("annualizes current monthly burn (× 12), active licenses only", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: null },
      { id: "l2", hireId: "h1", appId: "zoom", status: "active", grantedAt: null, lastUsedAt: null },
      { id: "l3", hireId: "h2", appId: "github", status: "revoked", grantedAt: null, lastUsedAt: null },
    ];
    // monthly burn 31 (21 + 10) × 12
    expect(projectedRunRate(licenses, apps)).toBe(372);
  });

  it("is zero with no active licenses", () => {
    expect(projectedRunRate([], apps)).toBe(0);
  });
});

describe("residualValue", () => {
  it("returns full cost at acquisition and depreciates straight-line", () => {
    const asset: Asset = { id: "a1", catalogId: "mbp", serialTag: "x", status: "assigned", assignedToHireId: "h1", acquiredAt: "2026-01-01", returnedAt: null };
    const atStart = residualValue(assetCatalog[0]!, asset, new Date("2026-01-01"));
    expect(atStart).toBe(2400);
    // 12 months into a 24-month schedule -> roughly half value
    // (months use average month length, so allow a small tolerance)
    const halfway = residualValue(assetCatalog[0]!, asset, new Date("2027-01-01"));
    expect(halfway).toBeGreaterThan(1190);
    expect(halfway).toBeLessThan(1210);
  });

  it("clamps to zero past full depreciation", () => {
    const asset: Asset = { id: "a1", catalogId: "mbp", serialTag: "x", status: "assigned", assignedToHireId: "h1", acquiredAt: "2020-01-01", returnedAt: null };
    expect(residualValue(assetCatalog[0]!, asset, new Date("2026-01-01"))).toBe(0);
  });
});

describe("reclaimable", () => {
  it("sums idle/reclaim license burn plus returned asset residual", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "idle", grantedAt: null, lastUsedAt: null },
      { id: "l2", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: null },
    ];
    const assets: Asset[] = [
      { id: "a1", catalogId: "mbp", serialTag: "x", status: "returned", assignedToHireId: null, acquiredAt: "2026-01-01", returnedAt: "2026-01-01" },
    ];
    const result = reclaimable(licenses, apps, assets, assetCatalog);
    // 21 (idle github monthly) + 2400 residual (returned same day it was acquired)
    expect(result).toBe(2421);
  });
});

describe("budget helpers", () => {
  const budget: Budget = { id: "b", team: "it", period: "p", limit: 1000, spent: 1200 };
  it("computes burn-down ratio", () => {
    expect(budgetBurnDown(budget)).toBe(1.2);
    expect(budgetBurnDown({ ...budget, limit: 0 })).toBe(0);
  });
  it("flags overspend", () => {
    expect(isOverspent(budget)).toBe(true);
    expect(isOverspent({ ...budget, spent: 500 })).toBe(false);
  });
});

describe("recurringAddedSince", () => {
  const mk = (id: string, amount: number, costType: "recurring" | "one_time", createdAt: string): LedgerEntry =>
    ({ id, hireId: "h1", type: "fee", label: id, amount, costType, refTable: null, refId: null, createdAt });

  it("sums only recurring entries at/after the cutoff", () => {
    const entries: LedgerEntry[] = [
      mk("a", 21, "recurring", "2026-03-10T09:00:00.000Z"), // after
      mk("b", 8, "recurring", "2026-03-10T00:00:00.000Z"),  // exactly at cutoff
      mk("c", 50, "recurring", "2026-03-09T23:59:59.000Z"), // before
      mk("d", 99, "one_time", "2026-03-10T12:00:00.000Z"),  // after but not recurring
    ];
    const since = new Date("2026-03-10T00:00:00.000Z");
    expect(recurringAddedSince(entries, since)).toBe(29); // 21 + 8
  });

  it("is zero when nothing qualifies", () => {
    expect(recurringAddedSince([], new Date())).toBe(0);
  });
});

describe("avgCostPerSpendingHire", () => {
  const entries: LedgerEntry[] = [
    { id: "1", hireId: "h1", type: "fee", label: "a", amount: 100, costType: "one_time", refTable: null, refId: null, createdAt: "" },
    { id: "2", hireId: "h2", type: "fee", label: "b", amount: 300, costType: "one_time", refTable: null, refId: null, createdAt: "" },
  ];

  it("averages only over hires that have spend", () => {
    // h3 has no spend, so it's excluded; (100 + 300) / 2 = 200
    expect(avgCostPerSpendingHire(entries, ["h1", "h2", "h3"])).toBe(200);
  });

  it("returns 0 when no hire has spend", () => {
    expect(avgCostPerSpendingHire([], ["h1", "h2"])).toBe(0);
  });
});

describe("monthlySpend", () => {
  const mk = (id: string, amount: number, costType: "recurring" | "one_time", createdAt: string): LedgerEntry =>
    ({ id, hireId: "h1", type: "fee", label: id, amount, costType, refTable: null, refId: null, createdAt });

  it("buckets by calendar month, oldest first, splitting recurring vs one-time", () => {
    const series = monthlySpend([
      mk("a", 21, "recurring", "2026-05-10T00:00:00.000Z"),
      mk("b", 2400, "one_time", "2026-05-20T00:00:00.000Z"),
      mk("c", 8, "recurring", "2026-06-01T00:00:00.000Z"),
    ]);
    expect(series.map((m) => m.month)).toEqual(["2026-05", "2026-06"]);
    expect(series[0]).toEqual({ month: "2026-05", total: 2421, recurring: 21, oneTime: 2400 });
    expect(series[1]).toEqual({ month: "2026-06", total: 8, recurring: 8, oneTime: 0 });
  });

  it("ignores entries with empty/malformed dates", () => {
    const series = monthlySpend([mk("a", 10, "recurring", "")]);
    expect(series).toHaveLength(0);
  });
});

describe("monthOverMonth", () => {
  it("computes change between the last two months", () => {
    const series = [
      { month: "2026-05", total: 100, recurring: 100, oneTime: 0 },
      { month: "2026-06", total: 125, recurring: 125, oneTime: 0 },
    ];
    const mom = monthOverMonth(series);
    expect(mom.current).toBe(125);
    expect(mom.comparison).toBe(100);
    expect(mom.absolute).toBe(25);
    expect(mom.pct).toBeCloseTo(0.25);
    expect(mom.comparable).toBe(true);
  });

  it("is not comparable with fewer than two months", () => {
    expect(monthOverMonth([]).comparable).toBe(false);
    expect(monthOverMonth([{ month: "2026-06", total: 50, recurring: 50, oneTime: 0 }]).comparable).toBe(false);
  });
});

describe("yearOverYear", () => {
  it("compares the latest month to the same calendar month a year earlier", () => {
    const series = [
      { month: "2025-10", total: 100, recurring: 100, oneTime: 0 }, // year-ago anchor
      { month: "2026-03", total: 50, recurring: 50, oneTime: 0 },   // noise in between
      { month: "2026-10", total: 160, recurring: 160, oneTime: 0 }, // latest
    ];
    const yoy = yearOverYear(series);
    expect(yoy.current).toBe(160);
    expect(yoy.comparison).toBe(100);
    expect(yoy.absolute).toBe(60);
    expect(yoy.pct).toBeCloseTo(0.6);
    expect(yoy.comparable).toBe(true);
  });

  it("is not comparable when the prior-year month is absent", () => {
    const series = [
      { month: "2026-06", total: 80, recurring: 80, oneTime: 0 },
      { month: "2026-10", total: 160, recurring: 160, oneTime: 0 },
    ];
    const yoy = yearOverYear(series);
    expect(yoy.comparable).toBe(false);
    expect(yoy.current).toBe(160);
  });

  it("handles an empty series", () => {
    expect(yearOverYear([]).comparable).toBe(false);
  });
});

describe("cumulativeRecurringBurn", () => {
  const mk = (id: string, amount: number, costType: "recurring" | "one_time", createdAt: string): LedgerEntry =>
    ({ id, hireId: "h1", type: "fee", label: id, amount, costType, refTable: null, refId: null, createdAt });

  it("runs recurring deltas into a monotonic monthly burn rate", () => {
    const series = cumulativeRecurringBurn([
      mk("a", 21, "recurring", "2026-05-10T00:00:00.000Z"),
      mk("b", 2400, "one_time", "2026-05-20T00:00:00.000Z"), // ignored (one-time)
      mk("c", 8, "recurring", "2026-06-05T00:00:00.000Z"),
      mk("d", 15, "recurring", "2026-07-01T00:00:00.000Z"),
    ]);
    expect(series.map((p) => [p.month, p.burn])).toEqual([
      ["2026-05", 21],
      ["2026-06", 29], // 21 + 8
      ["2026-07", 44], // + 15
    ]);
  });

  it("dips when a recurring credit (revoke) lands", () => {
    const series = cumulativeRecurringBurn([
      mk("a", 21, "recurring", "2026-05-10T00:00:00.000Z"),
      mk("b", -21, "recurring", "2026-06-10T00:00:00.000Z"), // revoke credit
    ]);
    expect(series.map((p) => p.burn)).toEqual([21, 0]);
  });
});

describe("burnDelta", () => {
  const pts = (xs: Array<[string, number]>) => xs.map(([month, burn]) => ({ month, burn }));

  it("MoM (lag 1) compares the last two burn points", () => {
    const d = burnDelta(pts([["2026-05", 29], ["2026-06", 44]]), 1);
    expect(d.current).toBe(44);
    expect(d.comparison).toBe(29);
    expect(d.absolute).toBe(15);
    expect(d.comparable).toBe(true);
  });

  it("YoY (lag 12) compares against the same month a year earlier", () => {
    const d = burnDelta(pts([["2025-10", 20], ["2026-03", 50], ["2026-10", 90]]), 12);
    expect(d.current).toBe(90);
    expect(d.comparison).toBe(20);
    expect(d.absolute).toBe(70);
    expect(d.comparable).toBe(true);
  });

  it("is not comparable when the prior point is missing", () => {
    expect(burnDelta(pts([["2026-10", 90]]), 1).comparable).toBe(false);
    expect(burnDelta(pts([["2026-06", 40], ["2026-10", 90]]), 12).comparable).toBe(false);
    expect(burnDelta([], 1).comparable).toBe(false);
  });
});

describe("assetsOnHand", () => {
  it("counts only in_stock assets", () => {
    const assets: Asset[] = [
      { id: "a1", catalogId: "mbp", serialTag: "x", status: "in_stock", assignedToHireId: null, acquiredAt: null, returnedAt: null },
      { id: "a2", catalogId: "mbp", serialTag: "y", status: "assigned", assignedToHireId: "h1", acquiredAt: null, returnedAt: null },
    ];
    expect(assetsOnHand(assets)).toBe(1);
  });
});

describe("financeSummary", () => {
  it("assembles the summary payload", () => {
    const summary = financeSummary({
      licenses: [{ id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: null }],
      apps,
      assets: [{ id: "a1", catalogId: "mbp", serialTag: "x", status: "in_stock", assignedToHireId: null, acquiredAt: null, returnedAt: null }],
      assetCatalog,
      ledgerEntries: [{ id: "e1", hireId: "h1", type: "license_grant", label: "g", amount: 21, costType: "recurring", refTable: null, refId: null, createdAt: "" }],
      budgets: [{ id: "b", team: "it", period: "p", limit: 10, spent: 50 }],
    });
    expect(summary.recurringMonthlyBurn).toBe(21);
    expect(summary.projectedAnnualRunRate).toBe(252);
    expect(summary.assetsOnHand).toBe(1);
    expect(summary.totalSpend).toBe(21);
    expect(summary.overspentTeams).toEqual(["it"]);
  });
});

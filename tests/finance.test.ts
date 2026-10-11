import {
  assetsOnHand,
  avgCostPerSpendingHire,
  budgetBurnDown,
  burnDelta,
  costPerHire,
  buildBvA,
  cumulativeRecurringBurn,
  financeSummary,
  forecastBurn,
  isOverspent,
  quarterLabel,
  quarterMonths,
  reclaimImpact,
  monthlyCost,
  monthlySpend,
  monthOverMonth,
  projectedRunRate,
  yearOverYear,
  recurringAddedSince,
  recurringMonthlyBurn,
  residualValue,
} from "@/lib/finance";
import type { BvAReport } from "@/lib/finance";
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

  it("does not count a requested (waiting) license toward burn", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "requested", grantedAt: null, lastUsedAt: null },
    ];
    expect(recurringMonthlyBurn(licenses, apps)).toBe(0);
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

  it("fills quiet months, carrying the burn rate forward across gaps and year boundaries", () => {
    const series = cumulativeRecurringBurn([
      mk("a", 8, "recurring", "2025-11-10T00:00:00.000Z"),
      // Dec 2025 and Jan 2026 are quiet — no ledger delta
      mk("b", 21, "recurring", "2026-02-05T00:00:00.000Z"),
    ]);
    // Every calendar month from first to last appears, in order, with quiet
    // months holding the prior rate (Nov 8 -> Dec 8 -> Jan 8 -> Feb 29).
    expect(series.map((p) => [p.month, p.burn])).toEqual([
      ["2025-11", 8],
      ["2025-12", 8],
      ["2026-01", 8],
      ["2026-02", 29],
    ]);
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

describe("forecastBurn", () => {
  const pts = (xs: number[], startMonth = 1) =>
    xs.map((burn, i) => ({ month: `2026-${String(startMonth + i).padStart(2, "0")}`, burn }));

  it("projects a steady upward slope forward", () => {
    // burn rising by 10/mo: 10,20,30,40 -> next should be 50, 60, 70
    const f = forecastBurn(pts([10, 20, 30, 40]), 3);
    expect(f.map((p) => p.burn)).toEqual([50, 60, 70]);
    expect(f.map((p) => p.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(f.every((p) => p.projected)).toBe(true);
  });

  it("holds flat when the trend is flat", () => {
    const f = forecastBurn(pts([100, 100, 100]), 2);
    expect(f.map((p) => p.burn)).toEqual([100, 100]);
  });

  it("clamps projected burn at zero on a declining trend", () => {
    // steep decline would go negative; must clamp to 0
    const f = forecastBurn(pts([30, 20, 10]), 3);
    expect(f.every((p) => p.burn >= 0)).toBe(true);
    expect(f[f.length - 1]!.burn).toBe(0);
  });

  it("rolls the month key across a year boundary", () => {
    const f = forecastBurn(pts([10, 20], 11), 3); // last month = 2026-12
    expect(f.map((p) => p.month)).toEqual(["2027-01", "2027-02", "2027-03"]);
  });

  it("returns nothing without enough data or months", () => {
    expect(forecastBurn([], 3)).toEqual([]);
    expect(forecastBurn(pts([10]), 3)).toEqual([]);
    expect(forecastBurn(pts([10, 20]), 0)).toEqual([]);
  });
});

describe("quarterMonths / quarterLabel", () => {
  it("returns the three months and label of the containing quarter", () => {
    expect(quarterMonths(new Date("2026-02-15T00:00:00Z"))).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(quarterMonths(new Date("2026-11-01T00:00:00Z"))).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(quarterLabel(new Date("2026-02-15T00:00:00Z"))).toBe("2026-Q1");
    expect(quarterLabel(new Date("2026-08-01T00:00:00Z"))).toBe("2026-Q3");
  });
});

describe("buildBvA", () => {
  const entry = (amount: number, costType: "recurring" | "one_time", createdAt: string): LedgerEntry =>
    ({ id: createdAt + amount, hireId: "h1", type: "fee", label: "x", amount, costType, refTable: null, refId: null, createdAt });

  it("builds actual (reset at quarter start), forecast beyond today, and variances", () => {
    // Q1 2026. asOf = mid-Feb -> Jan past, Feb current, Mar future.
    // Jan: 100 recurring. Feb: 50 recurring + 2000 one-time PO.
    const entries = [
      entry(100, "recurring", "2026-01-10T00:00:00Z"),
      entry(50, "recurring", "2026-02-05T00:00:00Z"),
      entry(2000, "one_time", "2026-02-20T00:00:00Z"),
      entry(999, "recurring", "2025-12-31T00:00:00Z"), // prior quarter — must be excluded by reset
    ];
    const bva = buildBvA({
      ledgerEntries: entries,
      budgetLimit: 3000,
      monthlyRecurringForecast: 150,
      asOf: new Date("2026-02-15T00:00:00Z"),
    });

    expect(bva.quarter).toBe("2026-Q1");
    // Jan cumulative = 100; Feb cumulative = 100 + 50 + 2000 = 2150 (Dec excluded)
    expect(bva.months[0]).toMatchObject({ month: "2026-01", actual: 100 });
    expect(bva.months[1]).toMatchObject({ month: "2026-02", actual: 2150 });
    // Mar is future: forecast = 2150 + 150 = 2300, actual null
    expect(bva.months[2]).toMatchObject({ month: "2026-03", actual: null, forecast: 2300 });

    expect(bva.actualToDate).toBe(2150);
    expect(bva.projectedEndOfQuarter).toBe(2300);
    // budget prorated to 2 of 3 months = 2000
    expect(bva.budgetToDate).toBeCloseTo(2000);
    expect(bva.varianceToDate).toBeCloseTo(150); // 2150 - 2000
    expect(bva.projectedVariance).toBe(-700);    // 2300 - 3000 (under)
    expect(bva.crossoverMonth).toBeNull();        // never exceeds 3000
  });

  it("reports remaining forecast months in the quarter", () => {
    // asOf mid-Feb -> Jan+Feb elapsed, Mar remaining = 1
    const bva = buildBvA({ ledgerEntries: [], budgetLimit: 3000, monthlyRecurringForecast: 100, asOf: new Date("2026-02-15T00:00:00Z") });
    expect(bva.remainingMonths).toBe(1);
    // asOf early Jan -> only Jan elapsed, Feb+Mar remaining = 2
    const bva2 = buildBvA({ ledgerEntries: [], budgetLimit: 3000, monthlyRecurringForecast: 100, asOf: new Date("2026-01-05T00:00:00Z") });
    expect(bva2.remainingMonths).toBe(2);
  });

  it("flags the crossover month when the line breaches the budget", () => {
    const entries = [
      entry(2800, "one_time", "2026-01-10T00:00:00Z"), // Jan already near ceiling
      entry(300, "recurring", "2026-02-05T00:00:00Z"), // Feb pushes over 3000
    ];
    const bva = buildBvA({
      ledgerEntries: entries,
      budgetLimit: 3000,
      monthlyRecurringForecast: 300,
      asOf: new Date("2026-02-15T00:00:00Z"),
    });
    // Jan=2800 (under), Feb=3100 (over) -> crossover in Feb
    expect(bva.crossoverMonth).toBe("2026-02");
    expect(bva.projectedVariance).toBeGreaterThan(0); // projected over budget
  });
});

describe("reclaimImpact", () => {
  const bvaWith = (projectedVariance: number, remainingMonths: number): BvAReport => ({
    quarter: "2026-Q1",
    months: [],
    budget: 3000,
    actualToDate: 0,
    projectedEndOfQuarter: 3000 + projectedVariance,
    budgetToDate: 0,
    varianceToDate: 0,
    projectedVariance,
    crossoverMonth: null,
    remainingMonths,
  });

  it("compounds monthly reclaimable over remaining months and clears the overage", () => {
    // projected $150 over, 2 months left, $100/mo reclaimable -> saves $200 -> under
    const impact = reclaimImpact(bvaWith(150, 2), 100);
    expect(impact.quarterSavings).toBe(200);
    expect(impact.projectedVarianceAfter).toBe(-50);
    expect(impact.bringsUnderBudget).toBe(true);
  });

  it("does not clear the overage when reclaim is too small", () => {
    // projected $500 over, 1 month left, $100/mo reclaimable -> saves $100 -> still over
    const impact = reclaimImpact(bvaWith(500, 1), 100);
    expect(impact.quarterSavings).toBe(100);
    expect(impact.projectedVarianceAfter).toBe(400);
    expect(impact.bringsUnderBudget).toBe(false);
  });

  it("is not 'brings under budget' when already under", () => {
    const impact = reclaimImpact(bvaWith(-200, 2), 100);
    expect(impact.bringsUnderBudget).toBe(false);
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
    // The reclaim figures are filled in by getFinanceSummary() from the
    // canonical reclaim engine; the pure assembler leaves them at 0 (and keeps
    // the two units separate — recurring $/mo vs one-time asset $).
    expect(summary.reclaimableRecurringMonthly).toBe(0);
    expect(summary.reclaimableOneTimeAsset).toBe(0);
  });
});

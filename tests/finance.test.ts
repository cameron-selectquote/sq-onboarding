import {
  assetsOnHand,
  budgetBurnDown,
  costPerHire,
  financeSummary,
  isOverspent,
  monthlyCost,
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
  { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly" },
  { id: "zoom", name: "Zoom", category: "comms", costPerSeat: 120, billing: "annual" },
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
    expect(summary.assetsOnHand).toBe(1);
    expect(summary.totalSpend).toBe(21);
    expect(summary.overspentTeams).toEqual(["it"]);
  });
});

/**
 * Finance calculations (BuildPlan §2 "Derived" + §4 finance workstream).
 *
 * Everything here is derived, never stored:
 *   - cost per hire        = sum of that hire's ledger entries
 *   - recurring burn       = sum of active license seat costs (monthly)
 *   - reclaimable          = recurring from idle/reclaim/duplicate licenses
 *                            + residual value of assets pending return
 *   - budget burn-down     = spent / limit
 *   - assets on hand       = count of in_stock assets
 *
 * These are pure functions over plain records so finance correctness can be
 * unit-tested in isolation.
 */

import { sum } from "./ledger";
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  LedgerEntry,
  License,
} from "./types";

/** Normalize any billing cadence to a monthly figure. */
export function monthlyCost(costPerSeat: number, billing: "monthly" | "annual"): number {
  return billing === "annual" ? costPerSeat / 12 : costPerSeat;
}

/** Cost per hire = sum of that hire's ledger entries. */
export function costPerHire(entries: LedgerEntry[], hireId: string): number {
  return sum(entries.filter((e) => e.hireId === hireId).map((e) => e.amount));
}

/**
 * Recurring monthly burn = sum of active license seat costs (normalized to
 * monthly). Only `active` licenses count toward live burn.
 */
export function recurringMonthlyBurn(
  licenses: License[],
  apps: AppCatalogItem[],
): number {
  const appById = indexById(apps);
  return sum(
    licenses
      .filter((l) => l.status === "active")
      .map((l) => {
        const app = appById.get(l.appId);
        return app ? monthlyCost(app.costPerSeat, app.billing) : 0;
      }),
  );
}

/** License statuses that represent recoverable recurring spend. */
const RECLAIMABLE_LICENSE_STATUSES: ReadonlySet<License["status"]> = new Set([
  "idle",
  "reclaim",
]);

/**
 * Reclaimable spend:
 *   - recurring monthly cost of licenses flagged idle/reclaim, plus
 *   - residual (depreciated) value of assets pending return.
 */
export function reclaimable(
  licenses: License[],
  apps: AppCatalogItem[],
  assets: Asset[],
  assetCatalog: AssetCatalogItem[],
): number {
  const appById = indexById(apps);
  const assetCatalogById = indexById(assetCatalog);

  const licenseReclaim = sum(
    licenses
      .filter((l) => RECLAIMABLE_LICENSE_STATUSES.has(l.status))
      .map((l) => {
        const app = appById.get(l.appId);
        return app ? monthlyCost(app.costPerSeat, app.billing) : 0;
      }),
  );

  const assetReclaim = sum(
    assets
      .filter((a) => a.status === "returned" || a.status === "retired")
      .map((a) => {
        const cat = assetCatalogById.get(a.catalogId);
        if (!cat) return 0;
        // Value a returned asset as of when it came back, not the wall clock.
        const asOf = a.returnedAt ? new Date(a.returnedAt) : new Date();
        return residualValue(cat, a, asOf);
      }),
  );

  return licenseReclaim + assetReclaim;
}

/**
 * Straight-line residual value of an asset given its catalog depreciation
 * schedule and how long it has been held. Clamped to [0, standardCost].
 */
export function residualValue(
  catalog: AssetCatalogItem,
  asset: Asset,
  asOf: Date = new Date(),
): number {
  if (catalog.depreciationMonths <= 0) {
    return catalog.standardCost;
  }
  if (!asset.acquiredAt) {
    return catalog.standardCost;
  }
  const monthsHeld = monthsBetween(new Date(asset.acquiredAt), asOf);
  const depreciated =
    catalog.standardCost * (monthsHeld / catalog.depreciationMonths);
  const residual = catalog.standardCost - depreciated;
  return clamp(residual, 0, catalog.standardCost);
}

/**
 * Projected annual run-rate = current recurring monthly burn × 12.
 *
 * Standard SaaS run-rate: annualize the present monthly recurring cost of all
 * active seats. Forward-looking companion to `recurringMonthlyBurn`.
 */
export function projectedRunRate(
  licenses: License[],
  apps: AppCatalogItem[],
): number {
  return recurringMonthlyBurn(licenses, apps) * 12;
}

/** Budget burn-down ratio in [0, ∞). 0 limit yields 0 to avoid div-by-zero. */
export function budgetBurnDown(budget: Budget): number {
  if (budget.limit <= 0) return 0;
  return budget.spent / budget.limit;
}

/** True when a budget is over its limit. */
export function isOverspent(budget: Budget): boolean {
  return budget.spent > budget.limit;
}

/** Assets available to assign without a new PO. */
export function assetsOnHand(assets: Asset[]): number {
  return assets.filter((a) => a.status === "in_stock").length;
}

export interface FinanceSummary {
  recurringMonthlyBurn: number;
  projectedAnnualRunRate: number;
  reclaimable: number;
  assetsOnHand: number;
  totalSpend: number;
  overspentTeams: string[];
}

/** The payload behind GET /api/finance/summary. */
export function financeSummary(input: {
  licenses: License[];
  apps: AppCatalogItem[];
  assets: Asset[];
  assetCatalog: AssetCatalogItem[];
  ledgerEntries: LedgerEntry[];
  budgets: Budget[];
}): FinanceSummary {
  return {
    recurringMonthlyBurn: recurringMonthlyBurn(input.licenses, input.apps),
    projectedAnnualRunRate: projectedRunRate(input.licenses, input.apps),
    reclaimable: reclaimable(
      input.licenses,
      input.apps,
      input.assets,
      input.assetCatalog,
    ),
    assetsOnHand: assetsOnHand(input.assets),
    totalSpend: sum(input.ledgerEntries.map((e) => e.amount)),
    overspentTeams: input.budgets.filter(isOverspent).map((b) => b.team),
  };
}

// ---- helpers --------------------------------------------------------------

function indexById<T extends { id: string }>(records: T[]): Map<string, T> {
  return new Map(records.map((r) => [r.id, r]));
}

function monthsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  const avgMonthMs = (365.25 / 12) * 24 * 60 * 60 * 1000;
  return ms / avgMonthMs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

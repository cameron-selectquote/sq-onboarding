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

/**
 * Sum of recurring ledger spend created at or after `since`. Used for the
 * "+$X today" delta on the burn tile. Caller passes the boundary (e.g. start of
 * the local day) so day-boundary semantics live with the caller's timezone, not
 * a UTC string prefix.
 */
export function recurringAddedSince(entries: LedgerEntry[], since: Date): number {
  const cutoff = since.getTime();
  return sum(
    entries
      .filter((e) => e.costType === "recurring" && new Date(e.createdAt).getTime() >= cutoff)
      .map((e) => e.amount),
  );
}

/**
 * Average ledger spend across hires that have any spend. Returns 0 when no hire
 * has spend. This is the overall cost-per-hire KPI (not the by-role breakdown
 * the reclaim page shows).
 */
export function avgCostPerSpendingHire(
  entries: LedgerEntry[],
  hireIds: string[],
): number {
  const spending = hireIds.filter((id) => entries.some((e) => e.hireId === id));
  if (spending.length === 0) return 0;
  return sum(spending.map((id) => costPerHire(entries, id))) / spending.length;
}

export interface MonthlySpend {
  /** Calendar month key, "YYYY-MM" (UTC). */
  month: string;
  /** All ledger spend created in that month (recurring + one-time + fees). */
  total: number;
  /** The recurring portion only. */
  recurring: number;
  /** The one-time portion only (POs, fees). */
  oneTime: number;
}

/**
 * Ledger spend bucketed by calendar month (UTC), oldest first. Each bucket
 * splits recurring vs one-time so the UI can chart either. Months with no
 * activity are omitted. This is the data behind the month-over-month / burn
 * trend view.
 */
export function monthlySpend(entries: LedgerEntry[]): MonthlySpend[] {
  const byMonth = new Map<string, MonthlySpend>();
  for (const e of entries) {
    const month = e.createdAt.slice(0, 7); // "YYYY-MM" from ISO
    if (!/^\d{4}-\d{2}$/.test(month)) continue; // skip malformed/empty dates
    const bucket =
      byMonth.get(month) ?? { month, total: 0, recurring: 0, oneTime: 0 };
    bucket.total += e.amount;
    if (e.costType === "recurring") bucket.recurring += e.amount;
    else bucket.oneTime += e.amount;
    byMonth.set(month, bucket);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface BurnPoint {
  /** Calendar month key, "YYYY-MM" (UTC). */
  month: string;
  /** Recurring burn rate ($/mo) in effect at the end of this month. */
  burn: number;
}

/**
 * Cumulative recurring burn rate month by month, oldest first. Recurring ledger
 * entries are deltas to the ongoing monthly cost (a grant adds, a revoke/credit
 * subtracts), so the running sum through each month is the burn rate as of that
 * month's end. This is the "costs growing over time" line — it climbs as seats
 * accrue and dips on reclaim, never spiking the way one-time POs do.
 *
 * Only months with recurring activity appear; each carries the running total,
 * so the series is monotonic in time between dips.
 */
export function cumulativeRecurringBurn(entries: LedgerEntry[]): BurnPoint[] {
  const deltaByMonth = new Map<string, number>();
  for (const e of entries) {
    if (e.costType !== "recurring") continue;
    const month = e.createdAt.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    deltaByMonth.set(month, (deltaByMonth.get(month) ?? 0) + e.amount);
  }
  const months = [...deltaByMonth.keys()].sort((a, b) => a.localeCompare(b));
  let running = 0;
  return months.map((month) => {
    running += deltaByMonth.get(month)!;
    return { month, burn: running };
  });
}

/**
 * Period-over-period delta over a cumulative burn series. `lagMonths` is how far
 * back to compare: 1 for month-over-month, 12 for year-over-year (matched by
 * month key, robust to gaps). `comparable` is false with no matching prior point.
 */
export function burnDelta(series: BurnPoint[], lagMonths: 1 | 12): TrendDelta {
  if (series.length === 0) return delta(0, 0, false);
  const burnByMonth = new Map(series.map((p) => [p.month, p.burn]));
  const latest = series[series.length - 1]!;
  const current = latest.burn;

  if (lagMonths === 1) {
    if (series.length < 2) return delta(current, 0, false);
    return delta(current, series[series.length - 2]!.burn, true);
  }
  // 12-month lag by month key.
  const [y, mo] = latest.month.split("-").map(Number) as [number, number];
  const priorKey = `${y - 1}-${String(mo).padStart(2, "0")}`;
  if (!burnByMonth.has(priorKey)) return delta(current, 0, false);
  return delta(current, burnByMonth.get(priorKey)!, true);
}

export interface TrendDelta {
  /** Spend in the most recent month. */
  current: number;
  /** Spend in the comparison month (prior month for MoM, year-ago for YoY). */
  comparison: number;
  /** current − comparison. */
  absolute: number;
  /** Ratio change (0.25 = +25%). 0 when the comparison month is 0. */
  pct: number;
  /** False when there's no comparison month to measure against. */
  comparable: boolean;
}

function delta(current: number, comparison: number, comparable: boolean): TrendDelta {
  const absolute = current - comparison;
  return {
    current,
    comparison,
    absolute,
    pct: comparison === 0 ? 0 : absolute / comparison,
    comparable,
  };
}

/**
 * Month-over-month change in total spend: the last month vs the month before it
 * in a `monthlySpend` series. `comparable` is false with fewer than two months.
 */
export function monthOverMonth(series: MonthlySpend[]): TrendDelta {
  if (series.length === 0) return delta(0, 0, false);
  if (series.length < 2) return delta(series[series.length - 1]!.total, 0, false);
  return delta(
    series[series.length - 1]!.total,
    series[series.length - 2]!.total,
    true,
  );
}

/**
 * Year-over-year change in total spend: the latest month vs the same calendar
 * month 12 months earlier, matched by month key (robust to gaps in the series).
 * `comparable` is false when that prior-year month has no data to compare to.
 */
export function yearOverYear(series: MonthlySpend[]): TrendDelta {
  if (series.length === 0) return delta(0, 0, false);
  const totalByMonth = new Map(series.map((m) => [m.month, m.total]));
  const latest = series[series.length - 1]!;
  const current = latest.total;

  // Compute the "YYYY-MM" key 12 months before the latest month.
  const [y, mo] = latest.month.split("-").map(Number) as [number, number];
  const priorKey = `${y - 1}-${String(mo).padStart(2, "0")}`;

  if (!totalByMonth.has(priorKey)) return delta(current, 0, false);
  return delta(current, totalByMonth.get(priorKey)!, true);
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

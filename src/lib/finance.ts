/**
 * Finance calculations (BuildPlan §2 "Derived" + §4 finance workstream).
 *
 * Everything here is derived, never stored:
 *   - cost per hire        = sum of that hire's ledger entries
 *   - recurring burn       = sum of active license seat costs (monthly)
 *   - reclaimable          = computed by the canonical reclaim engine
 *                            (buildReclaimReport in reclaim.ts), reported as two
 *                            unit-separated figures: recurring $/mo and the
 *                            one-time residual $ of pending-return assets
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

/** Preset finance date-range window. "all" means no lower bound (full history). */
export type FinanceRange = "3m" | "6m" | "12m" | "all";

/**
 * Start-of-window boundary for a preset finance range, at month granularity and
 * inclusive of the current month. For `Nm`, the window spans the last N calendar
 * months ending at `now`'s month, so the lower bound is the first day (local
 * midnight) of the month `N-1` months before `now`'s month (e.g. "3m" from a
 * June `now` starts Apr 1). `"all"` returns `null` (no lower bound). All finance
 * data is bucketed by "YYYY-MM", so a monthly boundary is the right grain; the
 * caller filters entries with `new Date(e.createdAt) >= rangeStart(...)`.
 */
export function rangeStart(now: Date, range: FinanceRange): Date | null {
  if (range === "all") return null;
  const n = range === "3m" ? 3 : range === "6m" ? 6 : 12;
  // JS Date normalizes a negative month into the prior year.
  return new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
}

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
  const active = [...deltaByMonth.keys()].sort((a, b) => a.localeCompare(b));
  if (active.length === 0) return [];

  // Walk every calendar month from the first to the last activity, inclusive —
  // not just the months that had a ledger delta. A recurring burn rate persists
  // when nothing changes, so a quiet month carries the prior month's rate
  // forward (delta 0) rather than vanishing. This yields a gapless monthly
  // series the trend chart can render without holes.
  const out: BurnPoint[] = [];
  let running = 0;
  let month = active[0]!;
  const lastMonth = active[active.length - 1]!;
  while (month <= lastMonth) {
    running += deltaByMonth.get(month) ?? 0;
    out.push({ month, burn: running });
    month = addMonths(month, 1);
  }
  return out;
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

export interface ForecastPoint {
  /** Calendar month key, "YYYY-MM" (UTC). */
  month: string;
  /** Projected recurring burn rate ($/mo) for this future month. */
  burn: number;
  /** Always true — marks these as projected, not actual, for the UI. */
  projected: true;
}

/** Add `n` months to a "YYYY-MM" key, returning a new "YYYY-MM" key. */
function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const zero = (y * 12 + (m - 1)) + n; // months since year 0
  const year = Math.floor(zero / 12);
  const month = (zero % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Project recurring burn forward `monthsAhead` months by fitting a least-squares
 * line to the last `lookback` points of the cumulative-burn series and
 * extending its slope. Trend-based (not flat) so the projection reflects the
 * recent growth rate — the "where we're headed" line for budget-vs-forecast.
 *
 * Returns future points only (not the history), each flagged `projected`.
 * Burn is clamped at >= 0 (you can't project a negative run-rate). An empty or
 * single-point series yields no forecast (nothing to fit a slope to).
 */
export function forecastBurn(
  series: BurnPoint[],
  monthsAhead: number,
  lookback = 6,
): ForecastPoint[] {
  if (series.length < 2 || monthsAhead <= 0) return [];

  // Fit y = a + b*x over the last `lookback` points, x = 0..n-1.
  const window = series.slice(-Math.max(2, lookback));
  const n = window.length;
  const xs = window.map((_, i) => i);
  const ys = window.map((p) => p.burn);
  const sumX = sum(xs);
  const sumY = sum(ys);
  const sumXY = sum(xs.map((x, i) => x * ys[i]!));
  const sumXX = sum(xs.map((x) => x * x));
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const lastMonth = window[n - 1]!.month;
  const out: ForecastPoint[] = [];
  for (let k = 1; k <= monthsAhead; k++) {
    const projected = intercept + slope * (n - 1 + k);
    out.push({
      month: addMonths(lastMonth, k),
      burn: Math.max(0, Math.round(projected)),
      projected: true,
    });
  }
  return out;
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

// ===== Budget vs Actual vs Forecast (BvA) ==================================

/** The three month keys of the quarter containing `date` (UTC), e.g. Q1 -> 01,02,03. */
export function quarterMonths(date: Date): string[] {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3); // 0..3
  const firstMonth = q * 3 + 1; // 1,4,7,10
  return [0, 1, 2].map((i) => `${y}-${String(firstMonth + i).padStart(2, "0")}`);
}

/** A short label for the quarter containing `date`, e.g. "2026-Q1". */
export function quarterLabel(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

export interface BvAMonth {
  /** Calendar month key, "YYYY-MM". */
  month: string;
  /** Flat budget ceiling for the quarter (same on every month — the plan line). */
  budget: number;
  /** Cumulative actual spend within the quarter through this month, or null if future. */
  actual: number | null;
  /** Cumulative projected spend through this month, or null for past months. */
  forecast: number | null;
}

export interface BvAReport {
  /** "2026-Q1" style label for the quarter in view. */
  quarter: string;
  /** One row per month of the quarter (3 rows), oldest first. */
  months: BvAMonth[];
  /** The quarter's flat budget limit. */
  budget: number;
  /** Cumulative actual spend so far this quarter (through the current month). */
  actualToDate: number;
  /** Projected cumulative spend at quarter end (actual + remaining forecast). */
  projectedEndOfQuarter: number;
  /** Budget prorated to the current month (limit × monthsElapsed / 3). */
  budgetToDate: number;
  /** actualToDate − budgetToDate. Positive = over plan right now. */
  varianceToDate: number;
  /** projectedEndOfQuarter − budget. Positive = projected to finish over. */
  projectedVariance: number;
  /** First month key where cumulative (actual or forecast) exceeds budget, or null. */
  crossoverMonth: string | null;
  /** Forecast months remaining in the quarter after the current month. */
  remainingMonths: number;
}

export interface ReclaimImpact {
  /** Monthly recurring spend currently reclaimable. */
  reclaimableMonthly: number;
  /** Its effect on the quarter-end forecast = reclaimableMonthly × remainingMonths. */
  quarterSavings: number;
  /** Projected end-of-quarter variance if the reclaimable spend is recovered now. */
  projectedVarianceAfter: number;
  /** True when reclaiming the available seats brings the quarter back under budget. */
  bringsUnderBudget: boolean;
}

/**
 * How reclaiming idle/flagged seats changes the quarter-end budget picture.
 * A reclaimed seat removes recurring spend, so its benefit compounds over the
 * remaining months: `reclaimableMonthly × remainingMonths`. This is the lever
 * that turns a projected overage back into headroom — the forecast ↔ reclaim
 * loop.
 */
export function reclaimImpact(bva: BvAReport, reclaimableMonthly: number): ReclaimImpact {
  const quarterSavings = reclaimableMonthly * bva.remainingMonths;
  const projectedVarianceAfter = bva.projectedVariance - quarterSavings;
  return {
    reclaimableMonthly,
    quarterSavings,
    projectedVarianceAfter,
    bringsUnderBudget: bva.projectedVariance > 0 && projectedVarianceAfter <= 0,
  };
}

/**
 * Which state the finance hero banner shows, derived purely from the BvA report
 * and its reclaim impact. Computes NO money — it only selects a state and
 * surfaces numbers that already live on `bva`/`reclaim`, so the banner can never
 * disagree with the Budget-vs-Actual panel or the reclaim page.
 *
 * - `overage`:  projected over budget AND seats are reclaimable — headline the
 *               forecast → reclaim loop with a "Fix the overage" CTA.
 * - `healthy`:  no actionable overage (projected under budget, or projected over
 *               but with nothing reclaimable), with the rounded variance away
 *               from $0 — a calm one-liner. `overBudget` tells the view whether
 *               to word it as "$N under" (headroom) or "$N over, no idle seats
 *               to reclaim" so the copy never contradicts the sign.
 * - `inflight`: projected over budget AND seats are reclaimable, but every
 *               reclaimable seat is already flagged (a pending/reclaiming job),
 *               so there's nothing left to action — show a "reclaim in progress,
 *               awaiting IT" status line instead of a CTA. `inFlightMonthly` is
 *               the recurring $/mo already flagged. This is what stops the
 *               "Fix the overage" button re-flagging seats it already flagged.
 * - `onplan`:   projected variance rounds to $0 — neutral "on plan" one-liner.
 */
export type FinanceHeroState =
  | {
      kind: "overage";
      projectedVariance: number;
      budget: number;
      crossoverMonth: string | null;
      reclaimableMonthly: number;
      quarterSavings: number;
      projectedVarianceAfter: number;
      bringsUnderBudget: boolean;
    }
  | {
      kind: "inflight";
      projectedVariance: number;
      budget: number;
      crossoverMonth: string | null;
      inFlightMonthly: number;
    }
  | { kind: "healthy"; amount: number; overBudget: boolean }
  | { kind: "onplan" };

/**
 * @param inFlight Optional split of the reclaimable seats into what's still
 *   actionable vs already flagged (in flight with IT), as recurring $/mo. Both
 *   figures derive from the same reclaim-queue rows, so they're recurring-only
 *   and never mix the one-time asset residual. When omitted, behavior is
 *   identical to before (no `inflight` state can be chosen), so existing callers
 *   keep their outcomes.
 */
export function financeHeroState(
  bva: BvAReport,
  reclaim: ReclaimImpact,
  inFlight?: { actionableMonthly: number; inFlightMonthly: number },
): FinanceHeroState {
  if (bva.projectedVariance > 0 && reclaim.reclaimableMonthly > 0) {
    if (inFlight && inFlight.actionableMonthly <= 0 && inFlight.inFlightMonthly > 0) {
      return {
        kind: "inflight",
        projectedVariance: bva.projectedVariance,
        budget: bva.budget,
        crossoverMonth: bva.crossoverMonth,
        inFlightMonthly: inFlight.inFlightMonthly,
      };
    }
    return {
      kind: "overage",
      projectedVariance: bva.projectedVariance,
      budget: bva.budget,
      crossoverMonth: bva.crossoverMonth,
      reclaimableMonthly: reclaim.reclaimableMonthly,
      quarterSavings: reclaim.quarterSavings,
      projectedVarianceAfter: reclaim.projectedVarianceAfter,
      bringsUnderBudget: reclaim.bringsUnderBudget,
    };
  }
  if (Math.round(bva.projectedVariance) === 0) {
    return { kind: "onplan" };
  }
  return {
    kind: "healthy",
    amount: Math.abs(bva.projectedVariance),
    overBudget: bva.projectedVariance > 0,
  };
}

/**
 * Recurring $/mo actually recovered this quarter — realized savings, traced to
 * the ledger (the single source of truth), not the reclaimable estimate.
 *
 * Sums the absolute value of recurring crediting `license_revoke` entries whose
 * `createdAt` month falls in the quarter containing `asOf` (bounded by the same
 * `quarterMonths` the BvA uses, so this can't disagree with the quarter in
 * view). Recurring-only: one-time asset returns, grants (positive amounts), and
 * out-of-quarter entries are excluded. Returned as a positive figure; `0` for
 * no qualifying entries.
 */
export function recoveredThisQuarter(entries: LedgerEntry[], asOf: Date = new Date()): number {
  const months = quarterMonths(asOf);
  return sum(
    entries
      .filter(
        (e) =>
          e.type === "license_revoke" &&
          e.costType === "recurring" &&
          e.amount < 0 &&
          months.includes(e.createdAt.slice(0, 7)),
      )
      .map((e) => Math.abs(e.amount)),
  );
}

/**
 * Budget vs Actual vs Forecast for the quarter containing `asOf`.
 *
 * - Actual: cumulative *total* spend (recurring + one-time), reset at quarter
 *   start, summed by month through the current month.
 * - Forecast: continues from actual-to-date, adding the trend-based recurring
 *   burn each remaining month (one-time POs are not predicted — conservative).
 * - Budget: the quarter's flat limit as a ceiling across all three months.
 *
 * `monthlyRecurringForecast` is the per-month recurring increment used to
 * project forward (derive it from forecastBurn's slope, or pass current burn).
 */
export function buildBvA(input: {
  ledgerEntries: LedgerEntry[];
  budgetLimit: number;
  monthlyRecurringForecast: number;
  asOf: Date;
}): BvAReport {
  const months = quarterMonths(input.asOf);
  const currentMonth = `${input.asOf.getUTCFullYear()}-${String(input.asOf.getUTCMonth() + 1).padStart(2, "0")}`;

  // Per-month total spend within the quarter (recurring + one-time), from the ledger.
  const spendByMonth = new Map<string, number>();
  for (const e of input.ledgerEntries) {
    const m = e.createdAt.slice(0, 7);
    if (months.includes(m)) spendByMonth.set(m, (spendByMonth.get(m) ?? 0) + e.amount);
  }

  const rows: BvAMonth[] = [];
  let cumulative = 0;
  let actualToDate = 0;
  let projectedCumulative = 0;
  let crossoverMonth: string | null = null;

  for (const month of months) {
    const isPast = month < currentMonth;
    const isCurrent = month === currentMonth;
    const isFuture = month > currentMonth;

    let actual: number | null = null;
    let forecast: number | null = null;

    if (isPast || isCurrent) {
      cumulative += spendByMonth.get(month) ?? 0;
      actual = cumulative;
      actualToDate = cumulative;
      projectedCumulative = cumulative; // forecast tracks actual up to now
    }
    if (isFuture) {
      projectedCumulative += input.monthlyRecurringForecast;
      forecast = projectedCumulative;
    }
    if (isCurrent) {
      forecast = cumulative; // forecast line meets actual at "today"
    }

    // Crossover: first month the running line (actual while known, else forecast)
    // exceeds the budget ceiling.
    const lineValue = isFuture ? projectedCumulative : cumulative;
    if (crossoverMonth === null && lineValue > input.budgetLimit) {
      crossoverMonth = month;
    }

    rows.push({ month, budget: input.budgetLimit, actual, forecast });
  }

  const monthsElapsed = months.filter((m) => m <= currentMonth).length;
  const budgetToDate = (input.budgetLimit * monthsElapsed) / 3;

  return {
    quarter: quarterLabel(input.asOf),
    months: rows,
    budget: input.budgetLimit,
    actualToDate,
    projectedEndOfQuarter: projectedCumulative,
    budgetToDate,
    varianceToDate: actualToDate - budgetToDate,
    projectedVariance: projectedCumulative - input.budgetLimit,
    crossoverMonth,
    remainingMonths: 3 - monthsElapsed,
  };
}

export interface FinanceSummary {
  recurringMonthlyBurn: number;
  projectedAnnualRunRate: number;
  /**
   * Recurring $/mo recoverable from flagged license seats, sourced from the
   * canonical reclaim engine (buildReclaimReport.recurringMonthly). Never summed
   * with the one-time asset figure below — they carry different units.
   */
  reclaimableRecurringMonthly: number;
  /**
   * One-time $ recoverable from the residual value of pending-return assets,
   * sourced from buildReclaimReport.oneTimeAssetResidual. A one-off, not a
   * monthly figure.
   */
  reclaimableOneTimeAsset: number;
  assetsOnHand: number;
  totalSpend: number;
  overspentTeams: string[];
}

/**
 * The payload behind GET /api/finance/summary.
 *
 * The two `reclaimable*` fields are left at 0 here and filled in by
 * getFinanceSummary() (src/server/queries.ts) from the canonical reclaim engine
 * (buildReclaimReport), so the summary and GET /api/reclaim describe the same
 * quantities and can't diverge. This pure function has no offboarding cohort to
 * run the engine itself.
 */
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
    reclaimableRecurringMonthly: 0,
    reclaimableOneTimeAsset: 0,
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

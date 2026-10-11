/**
 * Read models shared by API routes and server-rendered pages, so a page and
 * its endpoint can't drift apart.
 */

import { buildBvA, financeSummary, monthlyCost, reclaimImpact, recurringMonthlyBurn } from "@/lib/finance";
import { buildReclaimReport } from "@/lib/reclaim";
import type { LicenseReclaimFlag } from "@/lib/reclaim";
import type { BvAReport, FinanceSummary, ReclaimImpact } from "@/lib/finance";
import type { AppCatalogItem, Budget, Hire, LedgerEntry, License } from "@/lib/types";
import { OFFBOARDING_COHORT } from "@/data/seed";
import { getServices } from "./store";

/** The payload behind GET /api/finance/summary. */
export async function getFinanceSummary(): Promise<{ summary: FinanceSummary; budgets: Budget[] }> {
  const { repo } = await getServices();

  const [licenses, apps, assets, assetCatalog, ledgerEntries, budgets] =
    await Promise.all([
      repo.licenses.list(),
      repo.appCatalog.list(),
      repo.assets.list(),
      repo.assetCatalog.list(),
      repo.ledgerEntries.list(),
      repo.budgets.list(),
    ]);

  const summary = financeSummary({
    licenses,
    apps,
    assets,
    assetCatalog,
    ledgerEntries,
    budgets,
  });

  // Canonical "reclaimable": the summary, the finance dashboard, and
  // GET /api/reclaim must all agree, so both reclaim figures are sourced from
  // the single reclaim engine (buildReclaimReport, via getReclaimQueue) rather
  // than finance.ts. The two units stay separate — recurring $/mo and the
  // one-time asset residual $ are never summed. One computation behind both the
  // API and the view, so they can't drift.
  const { monthly: reclaimableMonthly, oneTimeAsset: reclaimableOneTimeAsset } =
    await getReclaimQueue();
  summary.reclaimableRecurringMonthly = reclaimableMonthly;
  summary.reclaimableOneTimeAsset = reclaimableOneTimeAsset;

  return { summary, budgets };
}

/** A ledger entry with the hire's display name resolved for the feed. */
export interface LedgerFeedEntry extends LedgerEntry {
  /** Hire name if the entry is tied to a hire, else null. */
  hireName: string | null;
}

/** Default cap on how many entries the feed returns. */
export const LEDGER_FEED_LIMIT = 50;

/**
 * The live ledger feed: entries newest-first, hire-name enriched, capped.
 * Shared by GET /api/finance/ledger and the finance overview's ledger panel so
 * the two can't drift. `limit` caps the result (defaults to LEDGER_FEED_LIMIT).
 */
export async function getLedgerFeed(
  limit: number = LEDGER_FEED_LIMIT,
): Promise<{ entries: LedgerFeedEntry[] }> {
  const { repo } = await getServices();
  const [ledgerEntries, hires] = await Promise.all([
    repo.ledgerEntries.list(),
    repo.hires.list(),
  ]);

  const hireById = new Map(hires.map((h) => [h.id, h]));
  const entries = [...ledgerEntries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, limit))
    .map((e) => ({
      ...e,
      hireName: (e.hireId && hireById.get(e.hireId)?.name) || null,
    }));

  return { entries };
}

const WHY: Record<string, string> = {
  idle: "No login in 30+ days",
  reclaim: "Marked for reclaim",
  duplicate: "Same category, already has another",
  role_mismatch: "Outside the role's stack",
};

export interface ReclaimSeat {
  licenseId: string;
  /** Hire holding the seat, or null if unassigned. */
  hireName: string | null;
  /** App display name. */
  app: string;
  /** Per-seat monthly cost. */
  monthly: number;
  /** The specific evidence for flagging (e.g. "Unused for 50 days (threshold 30)"). */
  detail: string;
}

export interface QueueRow {
  key: string;
  /** The reclaim reason this row aggregates (idle/reclaim/duplicate/role_mismatch). */
  reason: string;
  what: string;
  why: string;
  licenseIds: string[];
  monthly: number;
  /** Individual seats behind this row, for drill-down. */
  seats: ReclaimSeat[];
}

/**
 * Group the single reclaim engine's license flags into UI rows (one row per
 * reason × app). This is a *presenter* over buildReclaimReport — it does no
 * flagging of its own, so the dashboard and GET /api/reclaim can't diverge.
 */
function toQueueRows(
  licenseFlags: LicenseReclaimFlag[],
  licenses: License[],
  apps: AppCatalogItem[],
  hires: Hire[],
): QueueRow[] {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const licenseById = new Map(licenses.map((l) => [l.id, l]));
  const hireById = new Map(hires.map((h) => [h.id, h]));

  const rows = new Map<string, QueueRow>();
  for (const flag of licenseFlags) {
    const license = licenseById.get(flag.licenseId);
    const app = license ? appById.get(license.appId) : undefined;
    if (!license || !app) continue;
    const reason = flag.reason;
    const key = `${reason}:${app.id}`;
    const row = rows.get(key) ?? {
      key,
      reason,
      what: reason === "duplicate" ? `Duplicate ${app.name} seats` : `${reason === "reclaim" ? "Flagged" : "Idle"} ${app.name} seats`,
      why: WHY[reason] ?? reason,
      licenseIds: [],
      monthly: 0,
      seats: [],
    };
    const seatCost = monthlyCost(app.costPerSeat, app.billing);
    row.licenseIds.push(license.id);
    row.monthly += seatCost;
    row.seats.push({
      licenseId: license.id,
      hireName: hireById.get(license.hireId)?.name ?? null,
      app: app.name,
      monthly: seatCost,
      detail: flag.detail,
    });
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.monthly - a.monthly);
}

/**
 * The finance reclaim queue and its monthly total. Reads the single reclaim
 * engine (buildReclaimReport) and groups its license flags for display, so the
 * overview's Reclaimable tile, the reclaim page, and GET /api/reclaim all
 * trace to one computation. `monthly` equals the report's `recurringMonthly`
 * ($/mo) and `oneTimeAsset` equals its `oneTimeAssetResidual` (one-off $) —
 * kept as separate units, never summed.
 */
export async function getReclaimQueue(): Promise<{
  rows: QueueRow[];
  monthly: number;
  oneTimeAsset: number;
}> {
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

  const rows = toQueueRows(report.licenseFlags, licenses, apps, hires);
  return {
    rows,
    monthly: report.recurringMonthly,
    oneTimeAsset: report.oneTimeAssetResidual,
  };
}

/** Human labels + ordering for reclaim reasons in the waste breakdown. */
const REASON_LABEL: Record<string, string> = {
  idle: "Idle",
  reclaim: "Flagged for reclaim",
  duplicate: "Duplicate category",
  role_mismatch: "Wrong role",
};

export interface WasteReason {
  reason: string;
  label: string;
  /** Recoverable monthly spend from this reason. */
  monthly: number;
  /** Seats flagged for this reason. */
  seats: number;
}

export interface ReclaimBreakdown {
  /** One row per reclaim reason, biggest monthly first. */
  reasons: WasteReason[];
  /** Total recoverable monthly spend (sum across reasons). */
  monthly: number;
  /** Annualized recoverable spend (monthly × 12). */
  annual: number;
  /** Total flagged seats. */
  seats: number;
}

/**
 * Waste-by-reason breakdown for the reclaim page: the recoverable spend split by
 * *why* it's reclaimable (idle / duplicate / wrong-role), plus the annualized
 * total. Reads the same reclaim queue, so it stays consistent with everything
 * else on the page.
 */
export async function getReclaimBreakdown(): Promise<ReclaimBreakdown> {
  const { rows } = await getReclaimQueue();

  const byReason = new Map<string, WasteReason>();
  for (const row of rows) {
    const existing = byReason.get(row.reason) ?? {
      reason: row.reason,
      label: REASON_LABEL[row.reason] ?? row.reason,
      monthly: 0,
      seats: 0,
    };
    existing.monthly += row.monthly;
    existing.seats += row.licenseIds.length;
    byReason.set(row.reason, existing);
  }

  const reasons = [...byReason.values()].sort((a, b) => b.monthly - a.monthly);
  const monthly = reasons.reduce((acc, r) => acc + r.monthly, 0);
  const seats = reasons.reduce((acc, r) => acc + r.seats, 0);
  return { reasons, monthly, annual: monthly * 12, seats };
}

/**
 * Budget vs Actual vs Forecast for the current quarter (company-wide: all team
 * budgets summed, all ledger spend). Forward months accrue the current recurring
 * burn rate (conservative: "if we keep the seats we have, no new POs"). The
 * finance overview and any BvA endpoint read this, so they can't drift.
 */
export async function getBudgetVsActual(
  asOf: Date = new Date(),
): Promise<{ bva: BvAReport; reclaim: ReclaimImpact }> {
  const { repo } = await getServices();
  const [ledgerEntries, budgets, licenses, apps] = await Promise.all([
    repo.ledgerEntries.list(),
    repo.budgets.list(),
    repo.licenses.list(),
    repo.appCatalog.list(),
  ]);

  const budgetLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const monthlyRecurringForecast = recurringMonthlyBurn(licenses, apps);
  const bva = buildBvA({ ledgerEntries, budgetLimit, monthlyRecurringForecast, asOf });

  // Reclaim lever: how much the current reclaimable monthly spend would shift
  // the quarter-end forecast if recovered now.
  const { monthly: reclaimableMonthly } = await getReclaimQueue();
  const reclaim = reclaimImpact(bva, reclaimableMonthly);

  return { bva, reclaim };
}

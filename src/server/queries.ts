/**
 * Read models shared by API routes and server-rendered pages, so a page and
 * its endpoint can't drift apart.
 */

import { buildBvA, financeSummary, monthlyCost, recurringMonthlyBurn } from "@/lib/finance";
import { buildReclaimReport } from "@/lib/reclaim";
import type { LicenseReclaimFlag } from "@/lib/reclaim";
import type { BvAReport, FinanceSummary } from "@/lib/finance";
import type { AppCatalogItem, Budget, LedgerEntry, License } from "@/lib/types";
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

  // Canonical "reclaimable": the summary and the finance dashboard must agree,
  // so override finance.ts's status-only figure with the reclaim queue total
  // (idle/reclaim + rule-flagged seats) that the overview tile and reclaim page
  // already render. One computation (getReclaimQueue) behind both the API and
  // the view, so they can't drift.
  const { monthly: reclaimableMonthly } = await getReclaimQueue();
  summary.reclaimable = reclaimableMonthly;

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

export interface QueueRow {
  key: string;
  what: string;
  why: string;
  licenseIds: string[];
  monthly: number;
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
): QueueRow[] {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const licenseById = new Map(licenses.map((l) => [l.id, l]));

  const rows = new Map<string, QueueRow>();
  for (const flag of licenseFlags) {
    const license = licenseById.get(flag.licenseId);
    const app = license ? appById.get(license.appId) : undefined;
    if (!license || !app) continue;
    const reason = flag.reason;
    const key = `${reason}:${app.id}`;
    const row = rows.get(key) ?? {
      key,
      what: reason === "duplicate" ? `Duplicate ${app.name} seats` : `${reason === "reclaim" ? "Flagged" : "Idle"} ${app.name} seats`,
      why: WHY[reason] ?? reason,
      licenseIds: [],
      monthly: 0,
    };
    row.licenseIds.push(license.id);
    row.monthly += monthlyCost(app.costPerSeat, app.billing);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.monthly - a.monthly);
}

/**
 * The finance reclaim queue and its monthly total. Reads the single reclaim
 * engine (buildReclaimReport) and groups its license flags for display, so the
 * overview's Reclaimable tile, the reclaim page, and GET /api/reclaim all
 * trace to one computation. `monthly` equals the report's `recurringMonthly`.
 */
export async function getReclaimQueue(): Promise<{ rows: QueueRow[]; monthly: number }> {
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

  const rows = toQueueRows(report.licenseFlags, licenses, apps);
  return { rows, monthly: report.recurringMonthly };
}

/**
 * Budget vs Actual vs Forecast for the current quarter (company-wide: all team
 * budgets summed, all ledger spend). Forward months accrue the current recurring
 * burn rate (conservative: "if we keep the seats we have, no new POs"). The
 * finance overview and any BvA endpoint read this, so they can't drift.
 */
export async function getBudgetVsActual(asOf: Date = new Date()): Promise<BvAReport> {
  const { repo } = await getServices();
  const [ledgerEntries, budgets, licenses, apps] = await Promise.all([
    repo.ledgerEntries.list(),
    repo.budgets.list(),
    repo.licenses.list(),
    repo.appCatalog.list(),
  ]);

  const budgetLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const monthlyRecurringForecast = recurringMonthlyBurn(licenses, apps);

  return buildBvA({ ledgerEntries, budgetLimit, monthlyRecurringForecast, asOf });
}

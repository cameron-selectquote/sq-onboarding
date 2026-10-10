/**
 * Read models shared by API routes and server-rendered pages, so a page and
 * its endpoint can't drift apart.
 */

import { financeSummary, monthlyCost } from "@/lib/finance";
import { flagLicenses } from "@/lib/reclaim";
import type { FinanceSummary } from "@/lib/finance";
import type { AppCatalogItem, Budget, License } from "@/lib/types";
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

  return { summary, budgets };
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
 * Seats worth taking back: licenses already flagged idle/reclaim, plus active
 * seats the reclaim rules catch (stale, duplicate). One row per reason × app.
 */
function buildQueue(licenses: License[], apps: AppCatalogItem[]): QueueRow[] {
  const appById = new Map(apps.map((a) => [a.id, a]));
  const reasonById = new Map<string, string>();
  for (const l of licenses) {
    if (l.status === "idle" || l.status === "reclaim") reasonById.set(l.id, l.status);
  }
  for (const flag of flagLicenses(licenses, apps)) {
    if (!reasonById.has(flag.licenseId)) reasonById.set(flag.licenseId, flag.reason);
  }

  const rows = new Map<string, QueueRow>();
  for (const l of licenses) {
    const reason = reasonById.get(l.id);
    const app = appById.get(l.appId);
    if (!reason || !app) continue;
    const key = `${reason}:${app.id}`;
    const row = rows.get(key) ?? {
      key,
      what: reason === "duplicate" ? `Duplicate ${app.name} seats` : `${reason === "reclaim" ? "Flagged" : "Idle"} ${app.name} seats`,
      why: WHY[reason] ?? reason,
      licenseIds: [],
      monthly: 0,
    };
    row.licenseIds.push(l.id);
    row.monthly += monthlyCost(app.costPerSeat, app.billing);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.monthly - a.monthly);
}

/**
 * The finance reclaim queue and its monthly total. The overview's Reclaimable
 * tile and the reclaim page both read this, so they always agree.
 */
export async function getReclaimQueue(): Promise<{ rows: QueueRow[]; monthly: number }> {
  const { repo } = await getServices();
  const [licenses, apps] = await Promise.all([repo.licenses.list(), repo.appCatalog.list()]);
  const rows = buildQueue(licenses, apps);
  return { rows, monthly: rows.reduce((acc, r) => acc + r.monthly, 0) };
}

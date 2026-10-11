/**
 * Backdated ledger history (optional demo trend data).
 *
 * The base seed (`seed.ts`) creates no ledger entries; spend only accrues at
 * runtime. That leaves trend views (MoM, YoY, burn trend) with a single "now"
 * bucket. This loader backfills ~14 months of realistic grants, POs, and fees
 * so month-over-month, year-over-year, and burn-trend charts have real data.
 *
 * Deterministic by design — no randomness — so the demo looks identical every
 * run. Amounts and ids line up with the base seed's catalog and hires.
 *
 * Idempotent: safe to call more than once. The store loads it after loadSeed on
 * a fresh DB; it's optional, so a store without it simply shows empty trends.
 */

import type { Repository } from '@/lib/repository';
import type { LedgerEntry, LedgerEntryType, CostType, Team } from '@/lib/types';

/** ISO timestamp roughly `n` months before now (30-day months, mid-month). */
function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(15);
  d.setHours(12, 0, 0, 0);
  d.setMonth(d.getMonth() - n);
  return d.toISOString();
}

interface HistoryEntry {
  monthsBack: number;
  hireId: string | null;
  type: LedgerEntryType;
  label: string;
  amount: number;
  costType: CostType;
  budgetTeam: Team | null;
}

/**
 * A deliberately upward-trending ~14-month spend history: onboarding ramps up
 * over time, so recent months spend more than the same month a year ago. This
 * gives both month-over-month and year-over-year views real data to compare.
 * Months are 0 (this month) .. 13 (last year). The prior-year months (12-13)
 * are intentionally lighter so YoY shows a believable increase.
 */
const HISTORY: HistoryEntry[] = [
  // ===== PRIOR YEAR (lighter — pre-ramp baseline) =====
  // ---- 13 months ago (~ same month last year, minus one) ----
  { monthsBack: 13, hireId: 'hire_1', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },

  // ---- 12 months ago (same calendar month last year — the YoY anchor) ----
  { monthsBack: 12, hireId: 'hire_1', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 12, hireId: null, type: 'fee', label: 'Onboarding platform fee', amount: 120, costType: 'one_time', budgetTeam: 'hr' },

  // ---- 11 months ago ----
  { monthsBack: 11, hireId: 'hire_2', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },

  // ---- 9 months ago (a quiet quarter) ----
  { monthsBack: 9, hireId: 'hire_2', type: 'license_grant', label: 'Grant: Notion', amount: 10, costType: 'recurring', budgetTeam: 'it' },

  // ---- 7 months ago ----
  { monthsBack: 7, hireId: 'hire_3', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 7, hireId: 'hire_2', type: 'asset_purchase', label: 'PO: Monitor', amount: 320, costType: 'one_time', budgetTeam: 'facilities' },

  // ===== CURRENT YEAR (ramping up) =====
  // ---- 5 months ago: first two engineers onboard ----
  { monthsBack: 5, hireId: 'hire_1', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 5, hireId: 'hire_1', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 5, hireId: 'hire_1', type: 'asset_purchase', label: 'PO: MacBook Pro', amount: 2400, costType: 'one_time', budgetTeam: 'vendor' },

  // ---- 4 months ago ----
  { monthsBack: 4, hireId: 'hire_2', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 4, hireId: 'hire_2', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 4, hireId: 'hire_1', type: 'license_grant', label: 'Grant: Zoom (annual)', amount: 15, costType: 'recurring', budgetTeam: 'it' },

  // ---- 3 months ago: hardware-heavy month ----
  { monthsBack: 3, hireId: 'hire_2', type: 'asset_purchase', label: 'PO: MacBook Pro', amount: 2400, costType: 'one_time', budgetTeam: 'vendor' },
  { monthsBack: 3, hireId: 'hire_3', type: 'license_grant', label: 'Grant: Figma', amount: 15, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 3, hireId: 'hire_3', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 3, hireId: null, type: 'fee', label: 'Onboarding platform fee', amount: 120, costType: 'one_time', budgetTeam: 'hr' },

  // ---- 2 months ago ----
  { monthsBack: 2, hireId: 'hire_4', type: 'license_grant', label: 'Grant: Notion', amount: 10, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 2, hireId: 'hire_4', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 2, hireId: 'hire_3', type: 'asset_purchase', label: 'PO: Monitor', amount: 320, costType: 'one_time', budgetTeam: 'facilities' },

  // ---- 1 month ago: biggest ramp ----
  { monthsBack: 1, hireId: 'hire_5', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 1, hireId: 'hire_5', type: 'license_grant', label: 'Grant: Slack', amount: 8, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 1, hireId: 'hire_5', type: 'asset_purchase', label: 'PO: MacBook Pro', amount: 2400, costType: 'one_time', budgetTeam: 'vendor' },
  { monthsBack: 1, hireId: 'hire_4', type: 'license_grant', label: 'Grant: Jira', amount: 14, costType: 'recurring', budgetTeam: 'it' },

  // ---- this month (small, recent activity) ----
  // ---- this month (current quarter): a hiring surge drives spend toward the
  //      quarterly budget, so the BvA forecast crosses the line within the
  //      quarter — the "we're about to go over, reclaim to recover" setup.
  { monthsBack: 0, hireId: 'hire_3', type: 'license_grant', label: 'Grant: GitHub', amount: 21, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 0, hireId: 'hire_4', type: 'license_grant', label: 'Grant: Figma', amount: 15, costType: 'recurring', budgetTeam: 'it' },
  { monthsBack: 0, hireId: 'hire_5', type: 'asset_purchase', label: 'PO: MacBook Pro', amount: 2800, costType: 'one_time', budgetTeam: 'vendor' },
  { monthsBack: 0, hireId: 'hire_3', type: 'asset_purchase', label: 'PO: MacBook Pro', amount: 2800, costType: 'one_time', budgetTeam: 'vendor' },
  { monthsBack: 0, hireId: 'hire_4', type: 'asset_purchase', label: 'PO: Monitor', amount: 420, costType: 'one_time', budgetTeam: 'facilities' },
  { monthsBack: 0, hireId: null, type: 'fee', label: 'Onboarding platform fee', amount: 120, costType: 'one_time', budgetTeam: 'hr' },
];

/**
 * Insert the backdated history and keep budget `spent` in sync (mirrors what
 * LedgerService.writeEntry would have done when each entry was first written).
 */
export async function loadHistory(repo: Repository): Promise<void> {
  const budgets = await repo.budgets.list();
  const budgetByTeam = new Map(budgets.map((b) => [b.team, b]));
  const spentDelta = new Map<string, number>();

  let i = 0;
  for (const h of HISTORY) {
    const id = `hist_${String(i++).padStart(3, '0')}`;

    // Idempotent: skip entries already loaded so a re-run doesn't throw on a
    // duplicate id or double-count budget spend.
    if (await repo.ledgerEntries.get(id)) continue;

    const entry: LedgerEntry = {
      id,
      hireId: h.hireId,
      type: h.type,
      label: h.label,
      amount: h.amount,
      costType: h.costType,
      refTable: null,
      refId: null,
      createdAt: monthsAgo(h.monthsBack),
    };
    await repo.ledgerEntries.insert(entry);

    if (h.budgetTeam) {
      const budget = budgetByTeam.get(h.budgetTeam);
      if (budget) spentDelta.set(budget.id, (spentDelta.get(budget.id) ?? 0) + h.amount);
    }
  }

  for (const [budgetId, delta] of spentDelta) {
    const budget = budgets.find((b) => b.id === budgetId);
    if (budget) await repo.budgets.update(budgetId, { spent: budget.spent + delta });
  }
}

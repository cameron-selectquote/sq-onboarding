/**
 * Read models shared by API routes and server-rendered pages, so a page and
 * its endpoint can't drift apart.
 */

import {
  buildBvA,
  financeSummary,
  monthlyCost,
  reclaimImpact,
  recurringMonthlyBurn,
  residualValue,
} from '@/lib/finance';
import {buildReclaimReport} from '@/lib/reclaim';
import {seatPools} from '@/lib/seats';
import {hireProgress, hireStatus, toHireChecklist} from '@/lib/progress';
import {onboardingNorms} from '@/lib/onboarding-stats';
import type {OnboardingNorms} from '@/lib/onboarding-stats';
import type {SeatPool} from '@/lib/seats';
import type {HireStatus} from '@/lib/progress';
import type {LicenseReclaimFlag} from '@/lib/reclaim';
import type {BvAReport, FinanceSummary, ReclaimImpact} from '@/lib/finance';
import type {
  AppCatalogItem,
  Budget,
  Hire,
  LedgerEntry,
  License,
  ReclaimTask,
} from '@/lib/types';
import {OFFBOARDING_COHORT} from '@/data/seed';
import {getServices} from './store';

/** The payload behind GET /api/finance/summary. */
export async function getFinanceSummary(): Promise<{
  summary: FinanceSummary;
  budgets: Budget[];
}> {
  const {repo} = await getServices();

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
  const {monthly: reclaimableMonthly, oneTimeAsset: reclaimableOneTimeAsset} =
    await getReclaimQueue();
  summary.reclaimableRecurringMonthly = reclaimableMonthly;
  summary.reclaimableOneTimeAsset = reclaimableOneTimeAsset;

  return {summary, budgets};
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
): Promise<{entries: LedgerFeedEntry[]}> {
  const {repo} = await getServices();
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

  return {entries};
}

const WHY: Record<string, string> = {
  idle: 'No login in 30+ days',
  reclaim: 'Marked for reclaim',
  duplicate: 'Same category, already has another',
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
      what:
        reason === 'duplicate' ?
          `Duplicate ${app.name} seats`
        : `${reason === 'reclaim' ? 'Flagged' : 'Idle'} ${app.name} seats`,
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
  const {repo} = await getServices();
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

/**
 * Drop seats that already have an open reclaim job from the actionable queue
 * rows, WITHOUT touching the recoverable totals.
 *
 * Finance-page presenter only (BuildPlan reclaim-tracked-jobs, Option B): once a
 * seat has an open job (ReclaimTask 'pending'/'reclaiming'), it must stop
 * appearing as a clickable queue row so finance can't re-flag it — but its $/mo
 * stays in the banner/breakdown because the money is in flight, not recovered.
 * So this filters the *rows only*; it never recomputes or exposes a total.
 * Pure over its inputs: `rows` from getReclaimQueue, `inFlightLicenseIds` from
 * getReclaimJobs. A row whose seats are all in flight is removed entirely; a
 * partially-in-flight row keeps its remaining seats, with licenseIds/monthly/
 * seats recomputed to match what's still actionable.
 */
export function filterQueueForInFlight(
  rows: QueueRow[],
  inFlightLicenseIds: ReadonlySet<string>,
): QueueRow[] {
  if (inFlightLicenseIds.size === 0) return rows;
  const filtered: QueueRow[] = [];
  for (const row of rows) {
    const seats = row.seats.filter((s) => !inFlightLicenseIds.has(s.licenseId));
    if (seats.length === 0) continue;
    filtered.push({
      ...row,
      seats,
      licenseIds: seats.map((s) => s.licenseId),
      monthly: seats.reduce((acc, s) => acc + s.monthly, 0),
    });
  }
  return filtered;
}

/** Human labels + ordering for reclaim reasons in the waste breakdown. */
const REASON_LABEL: Record<string, string> = {
  idle: 'Idle',
  reclaim: 'Flagged for reclaim',
  duplicate: 'Duplicate category',
  role_mismatch: 'Wrong role',
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
  const {rows} = await getReclaimQueue();

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
  return {reasons, monthly, annual: monthly * 12, seats};
}

/** One open/closed reclaim job, enriched for the finance + IT views. */
export interface ReclaimJob {
  taskId: string;
  status: ReclaimTask['status'];
  licenseId: string;
  /** Hire holding the seat, or null if unassigned. */
  hireName: string | null;
  /** App display name. */
  app: string;
  /** Per-seat monthly cost ($/mo). */
  monthly: number;
  createdByTeam: ReclaimTask['createdByTeam'];
}

/**
 * The reclaim-job view shared by the finance page and the IT rail panel: open
 * jobs (pending/reclaiming) enriched with hire + app + per-seat $/mo, plus
 * lifecycle counts. This is a *presenter* over the reclaimTasks collection — it
 * does NOT touch getReclaimQueue/getReclaimBreakdown/buildReclaimReport, so
 * finance totals and the reclaim queue keep agreeing. Note: flagByStatus in the
 * reclaim engine already counts a 'reclaim'-status license once, so an open
 * job's seat is surfaced here but not double-counted in the recoverable totals.
 */
export async function getReclaimJobs(): Promise<{
  jobs: ReclaimJob[];
  counts: {pending: number; reclaiming: number; done: number};
}> {
  const {repo} = await getServices();
  const [reclaimTasks, licenses, apps, hires] = await Promise.all([
    repo.reclaimTasks.list(),
    repo.licenses.list(),
    repo.appCatalog.list(),
    repo.hires.list(),
  ]);

  const licenseById = new Map(licenses.map((l) => [l.id, l]));
  const appById = new Map(apps.map((a) => [a.id, a]));
  const hireById = new Map(hires.map((h) => [h.id, h]));

  const counts = {pending: 0, reclaiming: 0, done: 0};
  for (const t of reclaimTasks) {
    if (t.status === 'pending') counts.pending += 1;
    else if (t.status === 'reclaiming') counts.reclaiming += 1;
    else if (t.status === 'done') counts.done += 1;
  }

  const jobs: ReclaimJob[] = reclaimTasks
    .filter((t) => t.status === 'pending' || t.status === 'reclaiming')
    .map((t) => {
      const license = licenseById.get(t.licenseId);
      const app = license ? appById.get(license.appId) : undefined;
      return {
        taskId: t.id,
        status: t.status,
        licenseId: t.licenseId,
        hireName: (license && hireById.get(license.hireId)?.name) ?? null,
        app: app?.name ?? 'Unknown app',
        monthly: app ? monthlyCost(app.costPerSeat, app.billing) : 0,
        createdByTeam: t.createdByTeam,
      };
    });

  return {jobs, counts};
}

/**
 * Budget vs Actual vs Forecast for the current quarter (company-wide: all team
 * budgets summed, all ledger spend). Forward months accrue the current recurring
 * burn rate (conservative: "if we keep the seats we have, no new POs"). The
 * finance overview and any BvA endpoint read this, so they can't drift.
 */
export async function getBudgetVsActual(
  asOf: Date = new Date(),
): Promise<{bva: BvAReport; reclaim: ReclaimImpact}> {
  const {repo} = await getServices();
  const [ledgerEntries, budgets, licenses, apps] = await Promise.all([
    repo.ledgerEntries.list(),
    repo.budgets.list(),
    repo.licenses.list(),
    repo.appCatalog.list(),
  ]);

  const budgetLimit = budgets.reduce((acc, b) => acc + b.limit, 0);
  const monthlyRecurringForecast = recurringMonthlyBurn(licenses, apps);
  const bva = buildBvA({
    ledgerEntries,
    budgetLimit,
    monthlyRecurringForecast,
    asOf,
  });

  // Reclaim lever: how much the current reclaimable monthly spend would shift
  // the quarter-end forecast if recovered now.
  const {monthly: reclaimableMonthly} = await getReclaimQueue();
  const reclaim = reclaimImpact(bva, reclaimableMonthly);

  return {bva, reclaim};
}

/**
 * Seat utilization per app: owned / assigned / available. Only apps the company
 * actually owns seats for are returned, sorted by least-utilized first so the
 * biggest right-sizing opportunities surface at the top of the panel.
 */
export async function getSeatPools(): Promise<SeatPool[]> {
  const {repo} = await getServices();
  const [apps, licenses] = await Promise.all([
    repo.appCatalog.list(),
    repo.licenses.list(),
  ]);

  return seatPools(apps, licenses)
    .filter((p) => p.owned > 0)
    .sort((a, b) => a.assigned / a.owned - b.assigned / b.owned);
}

// ---- hire status (read-only "pull up a person") ---------------------------

/** One granted/active software seat on a hire's status card. */
export interface HireStatusSeat {
  app: string;
  /** License status: active / idle / reclaim / revoked / requested. */
  status: License['status'];
  /** Per-seat monthly cost ($/mo). */
  monthly: number;
}

/** One asset currently assigned to a hire. */
export interface HireStatusAsset {
  name: string;
  serialTag: string;
  /** Residual (depreciated) value today. */
  residual: number;
}

/** A read-only snapshot of where a hire is in onboarding + what they hold. */
export interface HireStatusSummary {
  hireId: string;
  name: string;
  roleName: string;
  startDate: string;
  managerName: string | null;
  /** True when this hire is in the offboarding cohort. */
  offboarding: boolean;
  /** Roll-up task status + progress. */
  status: HireStatus;
  done: number;
  total: number;
  /** The next open (or blocked) task title, if any. */
  nextTask: string | null;
  /** Active/idle seats the hire holds (what software they have/want). */
  seats: HireStatusSeat[];
  /** Hardware assigned to the hire (what hardware they have/want). */
  assets: HireStatusAsset[];
  /** Recurring $/mo across their active seats. */
  monthlyRecurring: number;
}

/**
 * Pull up a single hire: progress + the software seats and hardware they hold.
 * Read-only — composes the same progress/finance helpers the role views use so
 * the numbers match. Returns null when the hire id doesn't resolve.
 */
export async function getHireStatus(
  hireId: string,
  asOf: Date = new Date(),
): Promise<HireStatusSummary | null> {
  const {repo} = await getServices();
  const hire = await repo.hires.get(hireId);
  if (!hire) return null;

  const [tasks, licenses, apps, assets, assetCatalog, manager] =
    await Promise.all([
      repo.tasks.where((t) => t.hireId === hireId),
      repo.licenses.where((l) => l.hireId === hireId),
      repo.appCatalog.list(),
      repo.assets.where((a) => a.assignedToHireId === hireId),
      repo.assetCatalog.list(),
      hire.managerId ? repo.users.get(hire.managerId) : Promise.resolve(null),
    ]);

  const appById = new Map(apps.map((a) => [a.id, a]));
  const catById = new Map(assetCatalog.map((c) => [c.id, c]));
  const progress = hireProgress(tasks);

  // Seats the hire is actually holding (active or idle still cost money);
  // revoked seats are dropped since they're no longer theirs.
  const seats: HireStatusSeat[] = licenses
    .filter((l) => l.status !== 'revoked')
    .map((l) => {
      const app = appById.get(l.appId);
      return {
        app: app?.name ?? l.appId,
        status: l.status,
        monthly: app ? monthlyCost(app.costPerSeat, app.billing) : 0,
      };
    })
    .sort((a, b) => a.app.localeCompare(b.app));

  const statusAssets: HireStatusAsset[] = assets
    .filter((a) => a.status === 'assigned')
    .map((a) => {
      const cat = catById.get(a.catalogId);
      return {
        name: cat?.name ?? a.catalogId,
        serialTag: a.serialTag,
        residual: cat ? residualValue(cat, a, asOf) : 0,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const monthlyRecurring = seats
    .filter((s) => s.status === 'active' || s.status === 'idle')
    .reduce((sum, s) => sum + s.monthly, 0);

  return {
    hireId: hire.id,
    name: hire.name,
    roleName: hire.roleName,
    startDate: hire.startDate,
    managerName: manager?.name ?? null,
    offboarding: hire.cohort === OFFBOARDING_COHORT,
    status: hireStatus(tasks),
    done: progress.done,
    total: progress.total,
    nextTask: progress.next?.title ?? null,
    seats,
    assets: statusAssets,
    monthlyRecurring,
  };
}

// ---- Role-scoped Genie read models ----------------------------------------
//
// Cost-free, scope-aware snapshots backing the manager and employee Genie
// tools. They never return money fields (dollar amounts live only in the admin
// finance read models above), so the employee/manager chat surfaces can't leak
// spend even if a prompt slips.

/** Public, cost-free company facts for the employee concierge. */
export interface CompanyInfo {
  name: string;
  size: number;
  industry: string;
}

/** The company the app is seeded for (the first/only company record). */
export async function getCompanyInfo(): Promise<CompanyInfo | null> {
  const {repo} = await getServices();
  const [company] = await repo.companies.list();
  if (!company) return null;
  return {name: company.name, size: company.size, industry: company.industry};
}

/** A hire's manager, by name/email only — no reports-to graph, no costs. */
export interface ManagerInfo {
  name: string;
  email: string;
}

/** Resolve a hire's manager (null when the hire or manager isn't found). */
export async function getManagerForHire(
  hireId: string,
): Promise<ManagerInfo | null> {
  const {repo} = await getServices();
  const hire = await repo.hires.get(hireId);
  if (!hire?.managerId) return null;
  const manager = await repo.users.get(hire.managerId);
  if (!manager) return null;
  return {name: manager.name, email: manager.email};
}

/** A hire's own role framing + the tasks ahead — strictly cost-free. */
export interface MyRoleInfo {
  hireName: string;
  roleName: string;
  startDate: string;
  managerName: string | null;
  /** Cost-free checklist item titles, in order. */
  tasks: {title: string; team: string; done: boolean}[];
  done: number;
  total: number;
}

/**
 * The caller's own role/onboarding snapshot, built from the cost-free
 * `toHireChecklist` projection so no cost field can ride along. Returns null
 * when the hire id doesn't resolve.
 */
export async function getMyRoleInfo(
  hireId: string,
): Promise<MyRoleInfo | null> {
  const {repo} = await getServices();
  const hire = await repo.hires.get(hireId);
  if (!hire) return null;
  const [tasks, manager] = await Promise.all([
    repo.tasks.where((t) => t.hireId === hireId),
    hire.managerId ? repo.users.get(hire.managerId) : Promise.resolve(null),
  ]);
  const checklist = toHireChecklist(hire, tasks);
  return {
    hireName: checklist.hire.name,
    roleName: checklist.hire.roleName,
    startDate: checklist.hire.startDate,
    managerName: manager?.name ?? null,
    tasks: checklist.items.map((i) => ({
      title: i.title,
      team: i.ownerTeam,
      done: i.status === 'done',
    })),
    done: checklist.done,
    total: checklist.total,
  };
}

/** Company-wide onboarding norms (nominal duration + shared milestones). */
export async function getOnboardingNorms(): Promise<OnboardingNorms> {
  const {repo} = await getServices();
  const [hires, allTasks] = await Promise.all([
    repo.hires.list(),
    repo.tasks.list(),
  ]);
  const active = hires.filter((h) => h.cohort !== OFFBOARDING_COHORT);
  const tasksByHire = active.map((h) =>
    allTasks.filter((t) => t.hireId === h.id),
  );
  return onboardingNorms(tasksByHire);
}

/** One row in a manager's hire list — progress only, never cost. */
export interface ManagerHireRow {
  hireId: string;
  name: string;
  roleName: string;
  startDate: string;
  status: HireStatus;
  done: number;
  total: number;
  nextTask: string | null;
}

/** The hires a given manager owns, with cost-free progress. Empty if none. */
export async function getManagerHires(
  managerUserId: string,
): Promise<ManagerHireRow[]> {
  const {repo} = await getServices();
  const [hires, allTasks] = await Promise.all([
    repo.hires.where((h) => h.managerId === managerUserId),
    repo.tasks.list(),
  ]);
  return hires
    .map((hire) => {
      const tasks = allTasks.filter((t) => t.hireId === hire.id);
      const progress = hireProgress(tasks);
      return {
        hireId: hire.id,
        name: hire.name,
        roleName: hire.roleName,
        startDate: hire.startDate,
        status: hireStatus(tasks),
        done: progress.done,
        total: progress.total,
        nextTask: progress.next?.title ?? null,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * A manager-scoped, COST-FREE detail view of one of their hires. Reuses
 * getHireStatus but strips every money field (monthly/residual/monthlyRecurring)
 * at the boundary, and refuses hires the manager doesn't own.
 */
export interface ManagerHireDetail {
  hireId: string;
  name: string;
  roleName: string;
  startDate: string;
  managerName: string | null;
  offboarding: boolean;
  status: HireStatus;
  done: number;
  total: number;
  nextTask: string | null;
  /** Software seats the hire holds, by app + status (no cost). */
  software: {app: string; status: string}[];
  /** Hardware assigned to the hire, by name + serial (no residual value). */
  hardware: {name: string; serialTag: string}[];
}

/** Detail for one of a manager's own hires, or null if not theirs/not found. */
export async function getManagerHireDetail(
  managerUserId: string,
  hireId: string,
): Promise<ManagerHireDetail | null> {
  const {repo} = await getServices();
  const hire = await repo.hires.get(hireId);
  if (!hire || hire.managerId !== managerUserId) return null; // fail closed
  const s = await getHireStatus(hireId);
  if (!s) return null;
  return {
    hireId: s.hireId,
    name: s.name,
    roleName: s.roleName,
    startDate: s.startDate,
    managerName: s.managerName,
    offboarding: s.offboarding,
    status: s.status,
    done: s.done,
    total: s.total,
    nextTask: s.nextTask,
    software: s.seats.map((seat) => ({app: seat.app, status: seat.status})),
    hardware: s.assets.map((a) => ({name: a.name, serialTag: a.serialTag})),
  };
}

/** A candidate row for a manager's open roles — identity + role, no cost. */
export interface ManagerCandidateRow {
  id: string;
  name: string;
  title: string;
  roleName: string | null;
  startDate: string | null;
  onboarded: boolean;
}

/**
 * Candidates relevant to a manager: those whose hiringManagerId is this
 * manager, OR whose roleName matches a role the manager is already hiring for
 * (so a manager sees the pipeline for their open roles). Cost-free.
 */
export async function getManagerCandidates(
  managerUserId: string,
): Promise<ManagerCandidateRow[]> {
  const {repo} = await getServices();
  const [candidates, myHires] = await Promise.all([
    repo.candidates.list(),
    repo.hires.where((h) => h.managerId === managerUserId),
  ]);
  const myRoles = new Set(
    myHires.map((h) => h.roleName.toLowerCase()).filter(Boolean),
  );
  const mine = candidates.filter(
    (c) =>
      c.hiringManagerId === managerUserId ||
      (c.roleName != null && myRoles.has(c.roleName.toLowerCase())),
  );
  return mine
    .map((c) => ({
      id: c.id,
      name: c.name,
      title: c.title,
      roleName: c.roleName,
      startDate: c.startDate,
      onboarded: Boolean(c.hireId),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

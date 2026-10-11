/**
 * Domain types — the hour-1 contract (BuildPlan §2).
 *
 * These are the shapes every workstream builds against. Keep them stable;
 * changing a shape here is a coordination event for the whole team.
 */

// ---- Enums / unions -------------------------------------------------------

export type Role = 'admin' | 'specialist' | 'manager' | 'team_member' | 'hire';

export type Team = 'hr' | 'it' | 'vendor' | 'facilities' | 'finance';

export type Billing = 'monthly' | 'annual';

/** How a cost hits the ledger. */
export type CostType = 'none' | 'one_time' | 'recurring';

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'blocked' | 'done';

/**
 * License lifecycle.
 * - `requested`: asked for but not granted (e.g. deferred when a pool was full);
 *   holds no seat, carries no ledger spend, waits in IT's queue until granted.
 * - `active`/`idle`/`reclaim`: consuming a seat.
 * - `revoked`: cancelled/returned; the credit already hit the ledger.
 */
export type LicenseStatus = 'requested' | 'active' | 'idle' | 'reclaim' | 'revoked';

export type ReclaimTaskStatus = 'pending' | 'reclaiming' | 'done' | 'cancelled';

export type AssetStatus =
  | 'in_stock'
  | 'assigned'
  | 'in_repair'
  | 'returned'
  | 'retired';

/** What kind of thing a ledger entry represents. */
export type LedgerEntryType =
  | 'license_grant'
  | 'license_revoke'
  | 'asset_purchase'
  | 'asset_return'
  | 'fee';

// ---- Tables ---------------------------------------------------------------

export interface Company {
  id: string;
  name: string;
  size: number;
  industry: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  team: Team | null;
  managerId: string | null;
}

export interface AppCatalogItem {
  id: string;
  name: string;
  category: string;
  costPerSeat: number;
  billing: Billing;
  /** Total seats the company owns for this app (the licensing pool). */
  seatsOwned: number;
  /**
   * Seats already consumed by existing staff before this onboarding batch —
   * company-wide usage not represented by individual onboarding `license`
   * rows. Added to the live license count to get total seats in use.
   */
  seatsInUseBaseline: number;
}

export interface AssetCatalogItem {
  id: string;
  name: string;
  category: string;
  standardCost: number;
  depreciationMonths: number;
}

export interface Asset {
  id: string;
  catalogId: string;
  serialTag: string;
  status: AssetStatus;
  assignedToHireId: string | null;
  acquiredAt: string | null; // ISO date
  returnedAt: string | null; // ISO date
}

export interface Template {
  id: string;
  roleName: string;
}

export interface TemplateTask {
  id: string;
  templateId: string;
  title: string;
  ownerTeam: Team;
  cost: number;
  costType: CostType;
  /**
   * If set, this task grants a software seat for the given app when started.
   * Starting it checks pool capacity: assigns if a seat is free, blocks if not.
   */
  appId: string | null;
}

export interface Hire {
  id: string;
  name: string;
  email: string;
  roleName: string;
  managerId: string | null;
  startDate: string; // ISO date
  cohort: string | null;
}

export interface Task {
  id: string;
  hireId: string;
  title: string;
  ownerTeam: Team;
  status: TaskStatus;
  cost: number;
  costType: CostType;
  /**
   * If set, starting this task grants a seat for the given app (capacity-
   * checked). Instantiated from the originating template task.
   */
  appId: string | null;
}

export interface License {
  id: string;
  hireId: string;
  appId: string;
  status: LicenseStatus;
  grantedAt: string | null; // ISO date
  lastUsedAt: string | null; // ISO date
}

/**
 * A tracked reclaim job: finance flags a seat for reclaim, IT executes it.
 * The ledger credit happens only when the job completes (via LicenseService
 * .revoke); open/start/cancel never touch the ledger.
 */
export interface ReclaimTask {
  id: string;
  licenseId: string;
  status: ReclaimTaskStatus;
  createdByTeam: 'finance' | 'it';
  createdAt: string; // ISO datetime
  completedAt: string | null; // ISO datetime
  cancelledAt: string | null; // ISO datetime
}

export interface Budget {
  id: string;
  team: Team;
  period: string; // e.g. "2026-Q1"
  limit: number;
  spent: number;
}

export interface LedgerEntry {
  id: string;
  hireId: string | null;
  type: LedgerEntryType;
  label: string;
  /** Positive = spend, negative = credit/recovery. */
  amount: number;
  costType: CostType;
  refTable: string | null;
  refId: string | null;
  createdAt: string; // ISO datetime
}

export interface Notification {
  id: string;
  targetTeam: Team;
  message: string;
  batchId: string | null;
  read: boolean;
}

/**
 * A pre-hire record the Onboarding Genie searches by name. Publishing a plan
 * converts a candidate into a `hire` (status -> onboarding) with instantiated
 * tasks. Kept separate from `hire` so "found in the ATS" and "being onboarded"
 * are distinct states.
 */
export type CandidateStatus = 'new' | 'onboarding';

export interface Candidate {
  id: string;
  name: string;
  /** Job title from the offer letter, e.g. "Senior Software Engineer". */
  title: string;
  /** Suggested template roleName this title maps to, if known. */
  roleName: string | null;
  hiringManagerId: string | null;
  resumeFile: string | null;
  startDate: string | null; // ISO date, if set
  status: CandidateStatus;
  /** Set once a plan is published and the candidate becomes a hire. */
  hireId: string | null;
}

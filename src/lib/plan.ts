/**
 * Pending onboarding plan — the editable draft the Genie builds for a candidate
 * before it's published. It lives in the conversation (the client holds it and
 * sends it back each turn), so both the stateless Strands agent and the
 * scripted path adjust the same object.
 *
 * A plan is: which role template, start date, which software seats to grant,
 * and which auto-tasks to skip. Pure functions here apply adjustments; the
 * publish/execute step honors the result. No DB, no framework — unit-testable.
 */

import type { AppCatalogItem } from "./types";

export interface PendingPlan {
  candidateId: string;
  candidateName: string;
  /** Role template to instantiate (may differ from the candidate's on-file role). */
  roleName: string | null;
  /** ISO date, or null to default at publish time. */
  startDate: string | null;
  /** App ids to grant as seats. */
  seatAppIds: string[];
  /**
   * Lowercased keywords of automatable tasks the user asked to skip
   * (e.g. "badge", "laptop"). The executor drops tasks whose title matches.
   */
  skipTaskKeywords: string[];
}

/** Default software seats per role, by catalog app id. */
export function defaultSeatsForRole(roleName: string | null): string[] {
  const r = (roleName ?? "").toLowerCase();
  if (/engineer|developer|swe/.test(r)) return ["github", "slack"];
  if (/design/.test(r)) return ["figma", "slack"];
  return ["notion"];
}

/** Build the initial plan for a candidate. */
export function newPlan(input: {
  candidateId: string;
  candidateName: string;
  roleName: string | null;
  startDate: string | null;
}): PendingPlan {
  return {
    candidateId: input.candidateId,
    candidateName: input.candidateName,
    roleName: input.roleName,
    startDate: input.startDate,
    seatAppIds: defaultSeatsForRole(input.roleName),
    skipTaskKeywords: [],
  };
}

// ---- pure adjustments (return a new plan) --------------------------------

export function addSeat(plan: PendingPlan, appId: string): PendingPlan {
  if (plan.seatAppIds.includes(appId)) return plan;
  return { ...plan, seatAppIds: [...plan.seatAppIds, appId] };
}

export function removeSeat(plan: PendingPlan, appId: string): PendingPlan {
  return { ...plan, seatAppIds: plan.seatAppIds.filter((id) => id !== appId) };
}

export function setRole(plan: PendingPlan, roleName: string): PendingPlan {
  return { ...plan, roleName };
}

export function setStartDate(plan: PendingPlan, startDate: string): PendingPlan {
  return { ...plan, startDate };
}

/** Mark an automatable task (by keyword, e.g. "badge"/"laptop") to be skipped. */
export function skipTask(plan: PendingPlan, keyword: string): PendingPlan {
  const k = keyword.toLowerCase();
  if (plan.skipTaskKeywords.includes(k)) return plan;
  return { ...plan, skipTaskKeywords: [...plan.skipTaskKeywords, k] };
}

/** Undo a skip. */
export function includeTask(plan: PendingPlan, keyword: string): PendingPlan {
  const k = keyword.toLowerCase();
  return {
    ...plan,
    skipTaskKeywords: plan.skipTaskKeywords.filter((x) => x !== k),
  };
}

/** True if a task title was marked skipped. */
export function isSkipped(plan: PendingPlan, taskTitle: string): boolean {
  const t = taskTitle.toLowerCase();
  return plan.skipTaskKeywords.some((k) => t.includes(k));
}

// ---- app-name resolution --------------------------------------------------

/**
 * Resolve a free-text app reference ("slack", "git hub", "google workspace")
 * to a catalog app id. Matches by id, exact name, or name contains.
 */
export function resolveAppId(ref: string, apps: AppCatalogItem[]): string | null {
  const q = ref.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return null;
  const compact = q.replace(/\s+/g, "");
  for (const a of apps) {
    const name = a.name.toLowerCase();
    if (a.id === q || a.id === compact) return a.id;
    if (name === q) return a.id;
  }
  // Looser contains match (handles "google workspace" -> "Google Workspace").
  for (const a of apps) {
    const name = a.name.toLowerCase();
    if (name.includes(q) || q.includes(name) || a.id.includes(compact)) return a.id;
  }
  return null;
}

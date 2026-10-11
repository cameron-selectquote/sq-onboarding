/**
 * Onboarding progress (role-views spec: manager report + new-hire checklist).
 *
 *   - hireProgress:   done / total, percent, next open task, blocked flag
 *   - teamCell:       a hire's status for one owner team (specialist matrix)
 *   - toHireChecklist: the new-hire projection — deliberately carries NO cost
 *                      fields (AC #4). The new-hire page may only read this.
 *
 * Pure functions over plain records.
 */

import type { Hire, Task, TaskStatus, Team } from "./types";

export interface HireProgress {
  done: number;
  total: number;
  /** 0–100, rounded. 0 when the hire has no tasks. */
  pct: number;
  /** First task that isn't done; blocked tasks win so they surface first. */
  next: Task | null;
  blocked: boolean;
}

export function hireProgress(tasks: Task[]): HireProgress {
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const blocked = tasks.find((t) => t.status === "blocked") ?? null;
  return {
    done,
    total,
    pct: total === 0 ? 0 : Math.round((done / total) * 100),
    next: blocked ?? tasks.find((t) => t.status !== "done") ?? null,
    blocked: blocked !== null,
  };
}

/**
 * A hire's single roll-up status, derived from their tasks:
 *   - blocked:     any task is blocked (wins — surfaces the stuck hires)
 *   - done:        has tasks and every one is done
 *   - in_progress: at least one task has moved past "todo"
 *   - todo:        has tasks but none have started
 *   - none:        no tasks at all
 */
export type HireStatus = "none" | "todo" | "in_progress" | "blocked" | "done";

export function hireStatus(tasks: Task[]): HireStatus {
  if (tasks.length === 0) return "none";
  if (tasks.some((t) => t.status === "blocked")) return "blocked";
  if (tasks.every((t) => t.status === "done")) return "done";
  if (tasks.some((t) => t.status !== "todo")) return "in_progress";
  return "todo";
}

export type TeamCell =
  | { kind: "none" } // no tasks for this team
  | { kind: "done" }
  | { kind: "blocked" }
  | { kind: "not_started" }
  | { kind: "progress"; done: number; total: number };

/** Roll a hire's tasks for one owner team into a single matrix cell. */
export function teamCell(tasks: Task[], team: Team): TeamCell {
  const mine = tasks.filter((t) => t.ownerTeam === team);
  if (mine.length === 0) return { kind: "none" };
  if (mine.some((t) => t.status === "blocked")) return { kind: "blocked" };
  const done = mine.filter((t) => t.status === "done").length;
  if (done === mine.length) return { kind: "done" };
  if (mine.every((t) => t.status === "todo")) return { kind: "not_started" };
  return { kind: "progress", done, total: mine.length };
}

// ---- new-hire projection (cost-free) ---------------------------------------

export interface ChecklistItem {
  id: string;
  title: string;
  ownerTeam: Team;
  status: TaskStatus;
}

export interface HireChecklist {
  hire: Pick<Hire, "id" | "name" | "roleName" | "startDate" | "managerId">;
  items: ChecklistItem[];
  done: number;
  total: number;
}

/**
 * Build the new-hire checklist. Fields are picked explicitly (never spread) so
 * a cost field added to Task later can't leak onto the new-hire page.
 */
export function toHireChecklist(hire: Hire, tasks: Task[]): HireChecklist {
  const items = tasks
    .filter((t) => t.hireId === hire.id)
    .map((t) => ({ id: t.id, title: t.title, ownerTeam: t.ownerTeam, status: t.status }));
  return {
    hire: {
      id: hire.id,
      name: hire.name,
      roleName: hire.roleName,
      startDate: hire.startDate,
      managerId: hire.managerId,
    },
    items,
    done: items.filter((i) => i.status === "done").length,
    total: items.length,
  };
}

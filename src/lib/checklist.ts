/**
 * New-hire checklist projection (role-views spec, AC #4).
 *
 * The new-hire view must never render a dollar amount, cost, or budget. Rather
 * than trusting the UI to hide fields, the checklist endpoint returns this
 * projection, which copies an explicit allow-list of non-financial fields.
 * Anything added to Hire/Task later stays out unless it's added here on
 * purpose.
 *
 * Pure — plain records in, plain records out.
 */
import type { Hire, Task, TaskStatus, Team } from "./types";

export interface ChecklistTask {
  id: string;
  title: string;
  ownerTeam: Team;
  status: TaskStatus;
}

export interface ChecklistHire {
  id: string;
  name: string;
  roleName: string;
  startDate: string;
}

export interface TaskProgress {
  done: number;
  total: number;
  /** 0..100, rounded. 0 when there are no tasks. */
  percent: number;
}

export interface Checklist {
  hire: ChecklistHire;
  tasks: ChecklistTask[];
  progress: TaskProgress;
}

/** Done / total over any task-like records. */
export function taskProgress(tasks: ReadonlyArray<{ status: TaskStatus }>): TaskProgress {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

/** Build the cost-free checklist for one hire. */
export function toChecklist(hire: Hire, tasks: Task[]): Checklist {
  const own = tasks.filter((t) => t.hireId === hire.id);
  return {
    hire: {
      id: hire.id,
      name: hire.name,
      roleName: hire.roleName,
      startDate: hire.startDate,
    },
    tasks: own.map((t) => ({
      id: t.id,
      title: t.title,
      ownerTeam: t.ownerTeam,
      status: t.status,
    })),
    progress: taskProgress(own),
  };
}

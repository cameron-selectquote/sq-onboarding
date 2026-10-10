"use client";

import type { ReactNode } from "react";
import type { TaskStatus, Team } from "@/lib/types";
import { StatusBadge, TASK_STATUSES, statusLabel } from "./StatusBadge";

/**
 * Deliberately cost-free task shape so the same row is safe in the new-hire
 * view. Views that may show money pass it through `children`.
 */
export interface TaskRowTask {
  id: string;
  title: string;
  ownerTeam: Team;
  status: TaskStatus;
}

export function TaskRow({
  task,
  subtitle,
  onStatusChange,
  disabled,
  children,
}: {
  task: TaskRowTask;
  subtitle?: string;
  /** When set, renders a status select; otherwise a read-only badge. */
  onStatusChange?: (status: TaskStatus) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const selectId = `status-${task.id}`;
  return (
    <li className={`task-row task-${task.status}`}>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {subtitle ? <span>{subtitle}</span> : null}
          <span className="team-tag">{task.ownerTeam}</span>
        </div>
      </div>
      {children ? <div className="task-extra">{children}</div> : null}
      {onStatusChange ? (
        <div className="task-status">
          <label className="sr-only" htmlFor={selectId}>
            Status for {task.title}
          </label>
          <select
            id={selectId}
            value={task.status}
            disabled={disabled}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <StatusBadge status={task.status} />
      )}
    </li>
  );
}

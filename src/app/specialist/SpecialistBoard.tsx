"use client";

import Link from "next/link";
import { useState } from "react";
import type { TaskStatus } from "@/lib/types";
import { loadHireDetails, updateTaskStatus } from "../_components/api";
import { TASK_STATUSES, statusLabel } from "../_components/StatusBadge";
import { TaskRow } from "../_components/TaskRow";
import { formatUsd } from "../_components/format";
import { usePoll } from "../_components/usePoll";
import { ImportHireForm } from "./ImportHireForm";

const POLL_MS = 5000;

export function SpecialistBoard() {
  const { data, error, refresh } = usePoll(loadHireDetails, POLL_MS);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onStatusChange(taskId: string, status: TaskStatus) {
    setPendingId(taskId);
    setActionError(null);
    try {
      await updateTaskStatus(taskId, status);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  }

  const rows = (data ?? []).flatMap((d) =>
    d.tasks.map((task) => ({ task, hireName: d.hire.name })),
  );

  return (
    <>
      <h1>Onboarding board</h1>

      <ImportHireForm onImported={refresh} />

      {error ? <p className="error" role="alert">{error}</p> : null}
      {actionError ? <p className="error" role="alert">{actionError}</p> : null}

      <section className="panel" aria-labelledby="hires-heading">
        <h2 id="hires-heading">Hires</h2>
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul className="chips">
            {data.map((d) => {
              const done = d.tasks.filter((t) => t.status === "done").length;
              return (
                <li key={d.hire.id} className="chip">
                  <Link href={`/myonboarding?hire=${encodeURIComponent(d.hire.id)}`}>
                    {d.hire.name}
                  </Link>{" "}
                  <span className="muted">
                    · {d.hire.roleName} · {done}/{d.tasks.length} tasks
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data && rows.length === 0 ? (
        <p className="muted">No tasks yet. Import a hire to generate their onboarding tasks.</p>
      ) : null}

      <div className="board">
        {TASK_STATUSES.map((status) => {
          const col = rows.filter((r) => r.task.status === status);
          const headingId = `col-${status}`;
          return (
            <section key={status} className="board-col" aria-labelledby={headingId}>
              <h2 id={headingId}>
                <span>{statusLabel(status)}</span>
                <span className="muted">{col.length}</span>
              </h2>
              <ul className="task-list">
                {col.map(({ task, hireName }) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    subtitle={hireName}
                    disabled={pendingId === task.id}
                    onStatusChange={(s) => void onStatusChange(task.id, s)}
                  >
                    {task.costType === "none"
                      ? "No cost"
                      : `${formatUsd(task.cost)}${task.costType === "recurring" ? "/mo" : ""}`}
                  </TaskRow>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

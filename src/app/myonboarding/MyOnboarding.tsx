"use client";

/**
 * New-hire checklist. MUST NOT show costs (role-views AC #4).
 *
 * Guarded at the data layer: the only fetch is GET /api/hires/:id/checklist,
 * which returns a cost-free projection. Do not import format.ts, the finance
 * loaders, or HireDetail here.
 */
import { useCallback } from "react";
import { loadChecklist } from "../_components/api";
import { TaskRow } from "../_components/TaskRow";
import { usePoll } from "../_components/usePoll";

const POLL_MS = 5000;

export function MyOnboarding({ hireId }: { hireId: string }) {
  const load = useCallback(() => loadChecklist(hireId), [hireId]);
  const { data, error } = usePoll(load, POLL_MS);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading your checklist…</p>;

  const { hire, tasks, progress } = data;
  const firstName = hire.name.split(" ")[0] ?? hire.name;

  return (
    <>
      <h1>Welcome, {firstName}</h1>
      <section className="panel" aria-labelledby="progress-heading">
        <h2 id="progress-heading">Your onboarding</h2>
        <p className="muted">
          {hire.roleName} · starts {hire.startDate}
        </p>
        <progress max={Math.max(progress.total, 1)} value={progress.done} aria-label="Onboarding progress" />
        <p>
          {progress.done} of {progress.total} steps done
        </p>
      </section>
      <section className="panel" aria-labelledby="checklist-heading">
        <h2 id="checklist-heading">Checklist</h2>
        {tasks.length === 0 ? (
          <p className="muted">Your checklist is being set up. Check back soon.</p>
        ) : (
          <ul className="task-list">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} subtitle={`Handled by ${t.ownerTeam}`} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

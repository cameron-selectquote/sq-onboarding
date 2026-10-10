"use client";

import { taskProgress } from "@/lib/checklist";
import { loadHireDetails } from "../_components/api";
import { formatDate } from "../_components/format";
import { usePoll } from "../_components/usePoll";

/** Seeded manager. Real auth will supply the signed-in manager's id. */
const MANAGER_USER_ID = "u_mgr";
const POLL_MS = 5000;

export function ManagerReport() {
  const { data, error } = usePoll(loadHireDetails, POLL_MS);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading report…</p>;

  const mine = data.filter((d) => d.hire.managerId === MANAGER_USER_ID);

  return (
    <>
      <h1>Manager report</h1>
      <section className="panel" aria-labelledby="report-heading">
        <h2 id="report-heading">Your hires ({mine.length})</h2>
        {mine.length === 0 ? (
          <p className="muted">No hires reporting to you.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Hire</th>
                <th scope="col">Role</th>
                <th scope="col">Start</th>
                <th scope="col" className="num">Done</th>
                <th scope="col" className="num">Blocked</th>
                <th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((d) => {
                const p = taskProgress(d.tasks);
                const blocked = d.tasks.filter((t) => t.status === "blocked").length;
                return (
                  <tr key={d.hire.id}>
                    <td>{d.hire.name}</td>
                    <td>{d.hire.roleName}</td>
                    <td>{formatDate(d.hire.startDate)}</td>
                    <td className="num">
                      {p.done}/{p.total}
                    </td>
                    <td className="num">{blocked > 0 ? <span className="badge badge-blocked">{blocked}</span> : 0}</td>
                    <td>
                      <progress
                        max={Math.max(p.total, 1)}
                        value={p.done}
                        aria-label={`${d.hire.name} progress ${p.percent}%`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

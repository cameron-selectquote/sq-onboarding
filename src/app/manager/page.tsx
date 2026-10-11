import { getServices } from "@/server/store";
import { hireProgress } from "@/lib/progress";
import { PageHead, Shell } from "../_components/Shell";
import { DoubleClickCard } from "../_components/actions";
import { shortDate } from "../_components/format";

export const dynamic = "force-dynamic";

const WORDS = ["No one", "One person", "Two people", "Three people", "Four people", "Five people", "Six people", "Seven people", "Eight people", "Nine people", "Ten people"];

/** Manager report (design 2g): per-hire progress, computed from tasks. */
export default async function Manager() {
  const { repo } = await getServices();
  const [manager] = await repo.users.where((u) => u.role === "manager");
  const hires = manager ? await repo.hires.where((h) => h.managerId === manager.id) : [];
  const tasks = await repo.tasks.list();
  const cards = hires
    .map((hire) => ({ hire, progress: hireProgress(tasks.filter((t) => t.hireId === hire.id)) }))
    .sort((a, b) => a.hire.startDate.localeCompare(b.hire.startDate));

  return (
    <Shell nav={[{ href: "/manager", label: "My hires" }]} active="/manager" who={`Manager · ${manager?.name ?? "—"}`}>
      <PageHead eyebrow={`Team ${manager?.name.split(" ")[0] ?? ""}`} title={`${WORDS[cards.length] ?? `${cards.length} people`} on the way`} />
      <div className="hire-grid">
        {cards.map(({ hire, progress }) => (
          <DoubleClickCard key={hire.id} href={`/manager/${hire.id}`}>
            <article className="hire-card" title="Double-click to see tasks">
              <div
                className="ring"
                role="img"
                aria-label={`${progress.pct}% done`}
                style={{ background: `conic-gradient(var(--color-accent-2-500) 0 ${progress.pct}%, var(--color-neutral-200) 0)` }}
              >
                <div className="ring-inner">{progress.pct}%</div>
              </div>
              <div className="hire-body">
                <div className="hire-name">
                  <span>{hire.name}</span>
                  <span className="who-sub">{shortDate(hire.startDate)}</span>
                </div>
                <span style={{ fontSize: 13 }}>
                  {progress.done} of {progress.total} tasks done · {hire.roleName}
                </span>
                <div className={progress.blocked ? "next is-blocked" : "next"}>
                  <span className="next-label">{progress.blocked ? "Blocked" : progress.next ? "Up next" : "Ready"}</span>
                  <span className="next-value">{progress.next?.title ?? "All set for day one"}</span>
                </div>
              </div>
            </article>
          </DoubleClickCard>
        ))}
      </div>
    </Shell>
  );
}

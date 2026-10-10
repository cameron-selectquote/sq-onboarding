import { getServices } from "@/server/store";
import type { Task, TaskStatus } from "@/lib/types";
import { Avatar, PageHead, SegLinks, Shell } from "../_components/Shell";
import { TaskStatusSelect } from "../_components/actions";
import { costLabel, isTeam, teamLabel, teamTag } from "../_components/format";
import { SPECIALIST_NAV } from "./nav";

export const dynamic = "force-dynamic";

const COLUMNS: { name: string; statuses: TaskStatus[] }[] = [
  { name: "To do", statuses: ["todo"] },
  { name: "In progress", statuses: ["in_progress", "review"] },
  { name: "Blocked", statuses: ["blocked"] },
  { name: "Done", statuses: ["done"] },
];

const FILTERS = ["hr", "it", "vendor", "facilities"] as const;

/** Specialist board (design 2a): every hire's tasks by status. */
export default async function SpecialistBoard({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const { repo } = await getServices();
  const [hires, allTasks] = await Promise.all([repo.hires.list(), repo.tasks.list()]);
  const hireById = new Map(hires.map((h) => [h.id, h]));
  const tasks = isTeam(team) ? allTasks.filter((t) => t.ownerTeam === team) : allTasks;
  const cohorts = [...new Set(hires.map((h) => h.cohort).filter(Boolean))].join(", ");

  return (
    <Shell nav={SPECIALIST_NAV} active="/specialist" who="Specialist · HR">
      <PageHead eyebrow={`${cohorts || "All"} cohort · ${hires.length} hires`} title="Onboarding board">
        <SegLinks
          active={isTeam(team) ? `/specialist?team=${team}` : "/specialist"}
          options={[
            { href: "/specialist", label: "All teams" },
            ...FILTERS.map((t) => ({ href: `/specialist?team=${t}`, label: teamLabel(t) })),
          ]}
        />
      </PageHead>
      <div className="board">
        {COLUMNS.map((col) => {
          const cards = tasks.filter((t) => col.statuses.includes(t.status));
          return (
            <section key={col.name} className="col" aria-label={col.name}>
              <div className="col-head">
                <span>{col.name}</span>
                <span>{cards.length}</span>
              </div>
              {cards.length === 0 && <span className="empty">Nothing here.</span>}
              {cards.map((t: Task) => {
                const hire = hireById.get(t.hireId);
                return (
                  <article key={t.id} className="tcard">
                    <span className="tcard-title">{t.title}</span>
                    {hire && (
                      <div className="who">
                        <Avatar name={hire.name} size="sm" />
                        <span className="who-sub">{hire.name}</span>
                      </div>
                    )}
                    <div className="tcard-foot">
                      <span className={teamTag(t.ownerTeam)}>{teamLabel(t.ownerTeam)}</span>
                      <span>{costLabel(t.cost, t.costType)}</span>
                    </div>
                    <TaskStatusSelect taskId={t.id} status={t.status} />
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

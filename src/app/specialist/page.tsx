import { getServices } from "@/server/store";
import { hireProgress, hireStatus, type HireStatus } from "@/lib/progress";
import type { Hire } from "@/lib/types";
import { Avatar, PageHead, SegLinks, Shell } from "../_components/Shell";
import { ClickCard } from "../_components/actions";
import { isTeam, shortDate, teamLabel } from "../_components/format";
import { SPECIALIST_NAV } from "./nav";

export const dynamic = "force-dynamic";

const COLUMNS: { name: string; status: HireStatus }[] = [
  { name: "To do", status: "todo" },
  { name: "In progress", status: "in_progress" },
  { name: "Blocked", status: "blocked" },
  { name: "Done", status: "done" },
];

const FILTERS = ["hr", "it", "vendor", "facilities"] as const;

/** Specialist board (design 2a): every hire bucketed by onboarding status. */
export default async function SpecialistBoard({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const { repo } = await getServices();
  const [hires, allTasks] = await Promise.all([repo.hires.list(), repo.tasks.list()]);
  const tasks = isTeam(team) ? allTasks.filter((t) => t.ownerTeam === team) : allTasks;

  const cards = hires
    .map((hire) => {
      const mine = tasks.filter((t) => t.hireId === hire.id);
      return { hire, status: hireStatus(mine), progress: hireProgress(mine) };
    })
    .sort((a, b) => a.hire.startDate.localeCompare(b.hire.startDate));

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
          const inCol = cards.filter((c) => c.status === col.status);
          return (
            <section key={col.name} className="col" aria-label={col.name}>
              <div className="col-head">
                <span>{col.name}</span>
                <span>{inCol.length}</span>
              </div>
              {inCol.length === 0 && <span className="empty">Nothing here.</span>}
              {inCol.map(({ hire, progress }) => (
                <HireCard key={hire.id} hire={hire} done={progress.done} total={progress.total} />
              ))}
            </section>
          );
        })}
      </div>
    </Shell>
  );
}

function HireCard({ hire, done, total }: { hire: Hire; done: number; total: number }) {
  return (
    <ClickCard href={`/specialist/hires/${hire.id}`}>
      <article className="tcard" title="Click to open">
        <div className="who">
          <Avatar name={hire.name} size="sm" />
          <div className="who-text">
            <span className="who-name">{hire.name}</span>
            <span className="who-sub">{hire.roleName}</span>
          </div>
        </div>
        <div className="tcard-foot">
          <span>{total > 0 ? `${done} of ${total} tasks` : "No tasks"}</span>
          <span>{shortDate(hire.startDate)}</span>
        </div>
      </article>
    </ClickCard>
  );
}

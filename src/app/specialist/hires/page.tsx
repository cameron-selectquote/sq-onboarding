import { getServices } from "@/server/store";
import { hireProgress, teamCell, type TeamCell } from "@/lib/progress";
import type { Team } from "@/lib/types";
import { Avatar, Kpi, PageHead, Shell } from "../../_components/Shell";
import { ClickCard } from "../../_components/actions";
import { shortDate, teamLabel } from "../../_components/format";

export const dynamic = "force-dynamic";

const MATRIX_TEAMS: Team[] = ["hr", "it", "vendor", "facilities"];

function Cell({ cell }: { cell: TeamCell }) {
  switch (cell.kind) {
    case "none":
      return <span className="muted">—</span>;
    case "done":
      return <span className="pill pill-done">Done</span>;
    case "blocked":
      return <span className="pill pill-blocked">Blocked</span>;
    case "not_started":
      return <span className="pill pill-none">Not started</span>;
    case "progress":
      return <span className="pill pill-progress">{`${cell.done} of ${cell.total}`}</span>;
  }
}

/** Specialist hire × team matrix (design 2b): who's ready, who's stuck. */
export default async function SpecialistHires() {
  const { repo } = await getServices();
  const [hires, tasks] = await Promise.all([repo.hires.list(), repo.tasks.list()]);
  const rows = hires
    .map((hire) => {
      const mine = tasks.filter((t) => t.hireId === hire.id);
      return { hire, tasks: mine, progress: hireProgress(mine) };
    })
    .sort((a, b) => a.hire.startDate.localeCompare(b.hire.startDate));

  const ready = rows.filter((r) => r.progress.total > 0 && r.progress.done === r.progress.total).length;
  const blocked = rows.filter((r) => r.progress.blocked).length;
  const onTrack = rows.length - ready - blocked;
  const starts = rows.map((r) => r.hire.startDate);
  const range = starts.length ? `Starting ${shortDate(starts[0]!)} – ${shortDate(starts[starts.length - 1]!)}` : "No hires yet";

  return (
    <Shell active="/specialist/hires">
      <PageHead eyebrow={range} title="Who's ready, who's stuck" />
      <div className="kpis">
        <Kpi label="Ready" value={ready} sub="ready for day one" tone="good" />
        <Kpi label="On track" value={onTrack} sub="moving along" />
        <Kpi label="Blocked" value={blocked} sub="need a nudge" tone="warn" />
      </div>
      <div className="panel" style={{ gap: 0, paddingTop: 8 }}>
        <div className="row row-matrix is-head" role="row">
          <span>Hire</span>
          {MATRIX_TEAMS.map((t) => (
            <span key={t}>{teamLabel(t)}</span>
          ))}
          <span>Start</span>
        </div>
        {rows.map(({ hire, tasks: mine }) => (
          <ClickCard key={hire.id} href={`/specialist/hires/${hire.id}`}>
            <div className="row row-matrix" style={{ borderTop: "1px solid var(--color-divider)" }} title="Click to open">
              <div className="who">
                <Avatar name={hire.name} />
                <div className="who-text">
                  <span className="who-name">{hire.name}</span>
                  <span className="who-sub">{hire.roleName}</span>
                </div>
              </div>
              {MATRIX_TEAMS.map((t) => (
                <Cell key={t} cell={teamCell(mine, t)} />
              ))}
              <span style={{ fontSize: 13 }}>{shortDate(hire.startDate)}</span>
            </div>
          </ClickCard>
        ))}
      </div>
    </Shell>
  );
}

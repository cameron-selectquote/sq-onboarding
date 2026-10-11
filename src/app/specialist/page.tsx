import {getServices} from '@/server/store';
import {
  hireProgress,
  hireStatus,
  teamCell,
  type HireStatus,
  type TeamCell,
} from '@/lib/progress';
import {OFFBOARDING_COHORT} from '@/lib/cohorts';
import type {Hire, Team} from '@/lib/types';
import {Avatar, Kpi, PageHead, SegLinks, Shell} from '../_components/Shell';
import {ClickCard} from '../_components/actions';
import {isTeam, shortDate, teamLabel} from '../_components/format';

export const dynamic = 'force-dynamic';

const COLUMNS: {name: string; status: HireStatus}[] = [
  {name: 'To do', status: 'todo'},
  {name: 'In progress', status: 'in_progress'},
  {name: 'Blocked', status: 'blocked'},
  {name: 'Done', status: 'done'},
];

const FILTERS = ['hr', 'it', 'vendor', 'facilities'] as const;
const MATRIX_TEAMS: Team[] = ['hr', 'it', 'vendor', 'facilities'];

/**
 * Specialist onboarding workspace — Board + Hires on one page.
 *
 * Top: KPIs (ready / on track / blocked). Middle: the kanban board, every
 * active hire bucketed by onboarding status (team filter via the segmented
 * control). Bottom: the hire × team matrix, who's ready and who's stuck.
 */
export default async function SpecialistWorkspace({
  searchParams,
}: {
  searchParams: Promise<{team?: string}>;
}) {
  const {team} = await searchParams;
  const {repo} = await getServices();
  const [allHires, allTasks] = await Promise.all([
    repo.hires.list(),
    repo.tasks.list(),
  ]);

  // Offboarding hires drop off the active workspace (they live on reclaim).
  const hires = allHires.filter((h) => h.cohort !== OFFBOARDING_COHORT);
  const offboardingCount = allHires.length - hires.length;

  // One row per hire (sorted by start date) carrying its tasks + progress;
  // the board, KPIs, and matrix all read from this.
  const rows = hires
    .map((hire) => {
      const mine = allTasks.filter((t) => t.hireId === hire.id);
      return {
        hire,
        tasks: mine,
        status: hireStatus(mine),
        progress: hireProgress(mine),
      };
    })
    .sort((a, b) => a.hire.startDate.localeCompare(b.hire.startDate));

  // KPIs over every active hire (unaffected by the board's team filter).
  const ready = rows.filter(
    (r) => r.progress.total > 0 && r.progress.done === r.progress.total,
  ).length;
  const blocked = rows.filter((r) => r.progress.blocked).length;
  const onTrack = rows.length - ready - blocked;

  // The board can be filtered to a single owning team; the matrix always shows
  // the full picture. When filtered, re-bucket by the team's tasks only.
  const boardCards =
    isTeam(team) ?
      rows.map((r) => {
        const teamTasks = r.tasks.filter((t) => t.ownerTeam === team);
        return {
          hire: r.hire,
          status: hireStatus(teamTasks),
          progress: hireProgress(teamTasks),
        };
      })
    : rows.map((r) => ({
        hire: r.hire,
        status: r.status,
        progress: r.progress,
      }));

  const cohorts = [...new Set(hires.map((h) => h.cohort).filter(Boolean))].join(
    ', ',
  );
  const eyebrow =
    `${cohorts || 'All'} cohort · ${hires.length} hires` +
    (offboardingCount > 0 ? ` · ${offboardingCount} offboarding` : '');

  return (
    <Shell active='/specialist'>
      <PageHead eyebrow={eyebrow} title='Onboarding board' />

      <div className='kpis'>
        <Kpi label='Ready' value={ready} sub='ready for day one' tone='good' />
        <Kpi label='On track' value={onTrack} sub='moving along' />
        <Kpi label='Blocked' value={blocked} sub='need a nudge' tone='warn' />
      </div>

      {/* Middle: the kanban board, with the team filter above it. */}
      <div className='head' style={{marginBottom: 0}}>
        <div className='head-text'>
          <span className='eyebrow'>Board</span>
          <h2 className='title' style={{fontSize: 22}}>
            By onboarding status
          </h2>
        </div>
        <div className='actions'>
          <SegLinks
            active={isTeam(team) ? `/specialist?team=${team}` : '/specialist'}
            options={[
              {href: '/specialist', label: 'All teams'},
              ...FILTERS.map((t) => ({
                href: `/specialist?team=${t}`,
                label: teamLabel(t),
              })),
            ]}
          />
        </div>
      </div>
      <div className='board'>
        {COLUMNS.map((col) => {
          const inCol = boardCards.filter((c) => c.status === col.status);
          return (
            <section key={col.name} className='col' aria-label={col.name}>
              <div className='col-head'>
                <span>{col.name}</span>
                <span>{inCol.length}</span>
              </div>
              {inCol.length === 0 && (
                <span className='empty'>Nothing here.</span>
              )}
              {inCol.map(({hire, progress}) => (
                <HireCard
                  key={hire.id}
                  hire={hire}
                  done={progress.done}
                  total={progress.total}
                />
              ))}
            </section>
          );
        })}
      </div>

      {/* Bottom: the hire × team matrix — who's ready, who's stuck. */}
      <div className='head' style={{marginBottom: 0, marginTop: 28}}>
        <div className='head-text'>
          <span className='eyebrow'>Hires</span>
          <h2 className='title' style={{fontSize: 22}}>
            Who&rsquo;s ready, who&rsquo;s stuck
          </h2>
        </div>
      </div>
      <div className='panel' style={{gap: 0, paddingTop: 8}}>
        <div className='row row-matrix is-head' role='row'>
          <span>Hire</span>
          {MATRIX_TEAMS.map((t) => (
            <span key={t}>{teamLabel(t)}</span>
          ))}
          <span>Start</span>
        </div>
        {rows.length === 0 && <span className='empty'>No hires yet.</span>}
        {rows.map(({hire, tasks: mine}) => (
          <ClickCard key={hire.id} href={`/specialist/hires/${hire.id}`}>
            <div
              className='row row-matrix'
              style={{borderTop: '1px solid var(--color-divider)'}}
              title='Click to open'
            >
              <div className='who'>
                <Avatar name={hire.name} />
                <div className='who-text'>
                  <span className='who-name'>{hire.name}</span>
                  <span className='who-sub'>{hire.roleName}</span>
                </div>
              </div>
              {MATRIX_TEAMS.map((t) => (
                <Cell key={t} cell={teamCell(mine, t)} />
              ))}
              <span style={{fontSize: 13}}>{shortDate(hire.startDate)}</span>
            </div>
          </ClickCard>
        ))}
      </div>
    </Shell>
  );
}

function Cell({cell}: {cell: TeamCell}) {
  switch (cell.kind) {
    case 'none':
      return <span className='muted'>—</span>;
    case 'done':
      return <span className='pill pill-done'>Done</span>;
    case 'blocked':
      return <span className='pill pill-blocked'>Blocked</span>;
    case 'not_started':
      return <span className='pill pill-none'>Not started</span>;
    case 'progress':
      return (
        <span className='pill pill-progress'>{`${cell.done} of ${cell.total}`}</span>
      );
  }
}

function HireCard({
  hire,
  done,
  total,
}: {
  hire: Hire;
  done: number;
  total: number;
}) {
  return (
    <ClickCard href={`/specialist/hires/${hire.id}`}>
      <article className='tcard' title='Click to open'>
        <div className='who'>
          <Avatar name={hire.name} size='sm' />
          <div className='who-text'>
            <span className='who-name'>{hire.name}</span>
            <span className='who-sub'>{hire.roleName}</span>
          </div>
        </div>
        <div className='tcard-foot'>
          <span>{total > 0 ? `${done} of ${total} tasks` : 'No tasks'}</span>
          <span>{shortDate(hire.startDate)}</span>
        </div>
      </article>
    </ClickCard>
  );
}

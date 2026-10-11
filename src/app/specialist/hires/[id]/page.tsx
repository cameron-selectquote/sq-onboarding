import {notFound} from 'next/navigation';
import {getServices} from '@/server/store';
import {hireProgress, hireStatus} from '@/lib/progress';
import type {Task} from '@/lib/types';
import {Avatar, Kpi, Meter, PageHead, Shell} from '../../../_components/Shell';
import {
  hireStatusLabel,
  hireStatusPill,
  longDate,
  taskStatusLabel,
  taskStatusPill,
  teamLabel,
  teamTag,
} from '../../../_components/format';

export const dynamic = 'force-dynamic';

/** Specialist hire detail: one hire's status and every task under them. */
export default async function HireDetail({
  params,
}: {
  params: Promise<{id: string}>;
}) {
  const {id} = await params;
  const {repo} = await getServices();
  const hire = await repo.hires.get(id);
  if (!hire) notFound();

  const tasks = (await repo.tasks.where((t) => t.hireId === id)).sort(
    (a, b) =>
      a.ownerTeam.localeCompare(b.ownerTeam) || a.title.localeCompare(b.title),
  );
  const status = hireStatus(tasks);
  const progress = hireProgress(tasks);

  return (
    <Shell active='/specialist'>
      <PageHead
        eyebrow={`Starts ${longDate(hire.startDate)}`}
        title={hire.name}
      >
        <span className={hireStatusPill(status)}>
          {hireStatusLabel(status)}
        </span>
      </PageHead>

      <div
        className='panel'
        style={{flexDirection: 'row', alignItems: 'center', gap: 16}}
      >
        <Avatar name={hire.name} size='lg' />
        <div className='who-text'>
          <span className='who-name' style={{fontSize: 16}}>
            {hire.roleName}
          </span>
          <span className='who-sub'>
            {hire.email}
            {hire.cohort ? ` · ${hire.cohort} cohort` : ''}
          </span>
        </div>
      </div>

      <div className='kpis'>
        <Kpi label='Status' value={hireStatusLabel(status)} />
        <Kpi
          label='Tasks done'
          value={`${progress.done} / ${progress.total}`}
          sub='across all teams'
        />
        <Kpi
          label='Blocked'
          value={tasks.filter((t) => t.status === 'blocked').length}
          tone={progress.blocked ? 'warn' : undefined}
        />
      </div>

      {progress.total > 0 && (
        <Meter
          label='Onboarding progress'
          value={`${progress.pct}%`}
          pct={progress.pct}
        />
      )}

      <div className='panel' style={{gap: 0}}>
        <div className='panel-head' style={{paddingBottom: 8}}>
          <span className='panel-title'>Tasks</span>
          <span className='count'>{tasks.length}</span>
        </div>
        {tasks.length === 0 && (
          <span className='empty'>No tasks for this hire yet.</span>
        )}
        <div className='rows'>
          {tasks.map((t: Task) => (
            <div
              key={t.id}
              className='row'
              style={{gridTemplateColumns: 'minmax(0, 1fr) auto auto'}}
            >
              <span style={{fontWeight: 600}}>{t.title}</span>
              <span className={teamTag(t.ownerTeam)}>
                {teamLabel(t.ownerTeam)}
              </span>
              <span className={taskStatusPill(t.status)}>
                {taskStatusLabel(t.status)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

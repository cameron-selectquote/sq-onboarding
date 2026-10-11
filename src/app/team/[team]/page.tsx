import {notFound} from 'next/navigation';
import {getServices} from '@/server/store';
import {getReclaimJobs} from '@/server/queries';
import {monthlyCost} from '@/lib/finance';
import type {Task, TaskStatus} from '@/lib/types';
import {Avatar, PageHead, SegLinks, Shell} from '../../_components/Shell';
import {
  AssignSeatForm,
  MarkReadButton,
  RaisePoForm,
  ReclaimAllButton,
  ReclaimJobButton,
  TaskMoveButton,
} from '../../_components/actions';
import {
  costLabel,
  isTeam,
  money,
  shortDate,
  teamLabel,
} from '../../_components/format';

export const dynamic = 'force-dynamic';

const TABS: {key: string; label: string; statuses: TaskStatus[]}[] = [
  {key: 'todo', label: 'To do', statuses: ['todo', 'blocked']},
  {
    key: 'in_progress',
    label: 'In progress',
    statuses: ['in_progress', 'review'],
  },
  {key: 'done', label: 'Done', statuses: ['done']},
];

/** The one next move for a queue row. */
function nextMove(
  task: Task,
): {to: TaskStatus; label: string; primary: boolean} | null {
  switch (task.status) {
    case 'todo':
      return {to: 'in_progress', label: 'Start', primary: true};
    case 'blocked':
      return {to: 'in_progress', label: 'Unblock', primary: false};
    case 'in_progress':
    case 'review':
      return {to: 'done', label: 'Mark done', primary: true};
    case 'done':
      return null;
  }
}

/** Team queue (design 2e; collapses to the 2f mobile layout on narrow screens). */
export default async function TeamQueue({
  params,
  searchParams,
}: {
  params: Promise<{team: string}>;
  searchParams: Promise<{status?: string; view?: string}>;
}) {
  const {team} = await params;
  if (!isTeam(team)) notFound();
  const {status = 'todo', view} = await searchParams;
  const tab = TABS.find((t) => t.key === status) ?? TABS[0]!;

  const {repo, notifications: notifier} = await getServices();
  const [hires, allTasks, assets, assetCatalog, apps, inbox] =
    await Promise.all([
      repo.hires.list(),
      repo.tasks.where((t) => t.ownerTeam === team),
      repo.assets.where((a) => a.status === 'in_stock'),
      repo.assetCatalog.list(),
      repo.appCatalog.list(),
      notifier.forTeam(team),
    ]);
  const unreadCount = inbox.filter((n) => !n.read).length;
  const hireById = new Map(hires.map((h) => [h.id, h]));
  const startOf = (t: Task) => hireById.get(t.hireId)?.startDate ?? '';
  const tasks = allTasks
    .filter((t) => tab.statuses.includes(t.status))
    .sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const countFor = (statuses: TaskStatus[]) =>
    allTasks.filter((t) => statuses.includes(t.status)).length;

  const onHand = assetCatalog
    .map((c) => ({
      name: c.name,
      n: assets.filter((a) => a.catalogId === c.id).length,
    }))
    .filter((c) => c.n > 0);
  // IT-only: open reclaim jobs IT executes (finance flags, IT runs them).
  const reclaimJobs = team === 'it' ? (await getReclaimJobs()).jobs : [];
  const base = `/team/${team}`;

  // IT-only "Reclaim" tab, selected by a URL param on the same route. The open
  // count (pending + reclaiming) is already what getReclaimJobs() returns.
  // main's Shell owns the role-driven sidebar, so this Queue/Reclaim toggle
  // lives in-page as a segmented control (same pattern as the status tabs).
  const isReclaimView = team === 'it' && view === 'reclaim';
  const reclaimHref = `${base}?view=reclaim`;
  const viewTabs =
    team === 'it' ?
      [
        {href: base, label: `Queue · ${countFor(TABS[0]!.statuses)}`},
        {href: reclaimHref, label: `Reclaim · ${reclaimJobs.length}`},
      ]
    : null;

  return (
    <Shell active={base}>
      <div className='with-rail'>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            minWidth: 0,
          }}
        >
          {viewTabs && (
            <div>
              <SegLinks
                active={isReclaimView ? reclaimHref : base}
                options={viewTabs}
              />
            </div>
          )}
          {isReclaimView ?
            <>
              <PageHead eyebrow='IT team' title='Reclaim queue'>
                {reclaimJobs.length > 1 && (
                  <ReclaimAllButton
                    taskIds={reclaimJobs.map((j) => j.taskId)}
                    label={`Reclaim all ${reclaimJobs.length} seats`}
                  />
                )}
              </PageHead>
              <section
                className='panel'
                style={{gap: 0, padding: '6px 20px 10px'}}
              >
                {reclaimJobs.length === 0 && (
                  <span className='empty'>No seats flagged for reclaim.</span>
                )}
                <div className='rows'>
                  {reclaimJobs.map((j) => (
                    <div key={j.taskId} className='row row-queue'>
                      <div className='who'>
                        <Avatar name={j.hireName ?? '?'} />
                        <div className='who-text'>
                          <span className='who-name'>
                            {j.hireName ?? 'Unassigned'}
                          </span>
                          <span className='who-sub'>
                            {j.status === 'reclaiming' ?
                              'Reclaiming'
                            : 'Pending'}{' '}
                            · flagged by{' '}
                            {j.createdByTeam === 'it' ? 'IT' : 'Finance'}
                          </span>
                        </div>
                      </div>
                      <span style={{fontSize: 14}}>{j.app} seat</span>
                      <span className='muted' style={{fontSize: 13}}>
                        {money(Math.round(j.monthly * 100) / 100)}/mo
                      </span>
                      <span />
                      <span
                        style={{
                          display: 'flex',
                          gap: 8,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <ReclaimJobButton
                          taskId={j.taskId}
                          action='complete'
                          label='Revoke'
                          primary
                        />
                        <ReclaimJobButton
                          taskId={j.taskId}
                          action='cancel'
                          label='Cancel'
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          : <>
              <PageHead
                eyebrow={`${teamLabel(team)} team`}
                title='Your queue'
              />
              <div>
                <SegLinks
                  active={
                    tab.key === 'todo' ? base : `${base}?status=${tab.key}`
                  }
                  options={TABS.map((t) => ({
                    href: t.key === 'todo' ? base : `${base}?status=${t.key}`,
                    label: `${t.label} · ${countFor(t.statuses)}`,
                  }))}
                />
              </div>
              <section
                className='panel'
                style={{gap: 0, padding: '6px 20px 10px'}}
              >
                {tasks.length === 0 && (
                  <span className='empty'>Queue&apos;s clear.</span>
                )}
                <div className='rows'>
                  {tasks.map((t) => {
                    const hire = hireById.get(t.hireId);
                    const move = nextMove(t);
                    return (
                      <div key={t.id} className='row row-queue'>
                        <div className='who'>
                          <Avatar name={hire?.name ?? '?'} />
                          <div className='who-text'>
                            <span className='who-name'>
                              {hire?.name ?? 'Unknown hire'}
                            </span>
                            <span className='who-sub'>{hire?.roleName}</span>
                          </div>
                        </div>
                        <span style={{fontSize: 14}}>
                          {t.title}
                          {t.status === 'blocked' && (
                            <span
                              className='pill pill-blocked'
                              style={{marginLeft: 8}}
                            >
                              Blocked
                            </span>
                          )}
                        </span>
                        <span className='muted' style={{fontSize: 13}}>
                          {costLabel(t.cost, t.costType)}
                        </span>
                        <span className='muted' style={{fontSize: 13}}>
                          {hire ? shortDate(hire.startDate) : ''}
                        </span>
                        {move ?
                          <TaskMoveButton taskId={t.id} {...move} />
                        : <span className='pill pill-done'>Done</span>}
                      </div>
                    );
                  })}
                </div>
              </section>
              {team === 'it' && (
                <section className='panel' style={{padding: '16px 20px 20px'}}>
                  <span className='panel-title' style={{fontSize: 18}}>
                    Assign an extra seat
                  </span>
                  <AssignSeatForm
                    hires={hires.map((h) => ({id: h.id, name: h.name}))}
                    apps={apps.map((a) => ({
                      id: a.id,
                      name: a.name,
                      monthlyCost: monthlyCost(a.costPerSeat, a.billing),
                    }))}
                  />
                </section>
              )}
            </>
          }
        </div>

        <aside className='rail'>
          <section className='panel' style={{padding: 20, gap: 10}}>
            <div
              className='meter-head'
              style={{fontSize: 18, alignItems: 'center'}}
            >
              <span className='panel-title' style={{fontSize: 18}}>
                Inbox
              </span>
              {unreadCount > 0 && (
                <span className='tag tag-accent-2'>{unreadCount} new</span>
              )}
            </div>
            {inbox.length === 0 && (
              <span className='empty'>No notifications.</span>
            )}
            {inbox.slice(0, 8).map((n) => (
              <div
                key={n.id}
                className='row'
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '6px 0',
                  opacity: n.read ? 0.55 : 1,
                }}
              >
                <span style={{fontSize: 13, lineHeight: 1.4}}>
                  {!n.read && (
                    <span
                      aria-hidden
                      style={{
                        display: 'inline-block',
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: 'var(--color-accent)',
                        marginRight: 7,
                      }}
                    />
                  )}
                  {n.message}
                </span>
                {!n.read && <MarkReadButton id={n.id} />}
              </div>
            ))}
          </section>

          {team === 'vendor' && (
            <section className='panel' style={{padding: 20, gap: 12}}>
              <span className='panel-title' style={{fontSize: 18}}>
                On hand
              </span>
              {onHand.length === 0 && (
                <span className='empty'>Nothing in stock.</span>
              )}
              {onHand.map((v) => (
                <div
                  key={v.name}
                  className='meter-head'
                  style={{fontSize: 14, alignItems: 'center'}}
                >
                  <span>{v.name}</span>
                  <span className='count'>{v.n}</span>
                </div>
              ))}
            </section>
          )}

          {team === 'vendor' && (
            <section className='panel' style={{padding: 20, gap: 12}}>
              <span className='panel-title' style={{fontSize: 18}}>
                Raise a PO
              </span>
              <RaisePoForm
                hires={hires.map((h) => ({id: h.id, name: h.name}))}
                catalog={assetCatalog.map((c) => ({id: c.id, name: c.name}))}
              />
            </section>
          )}
        </aside>
      </div>
    </Shell>
  );
}

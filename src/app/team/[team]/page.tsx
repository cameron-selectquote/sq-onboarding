import {notFound} from 'next/navigation';
import {getServices} from '@/server/store';
import type {Task, TaskStatus} from '@/lib/types';
import {Avatar, PageHead, SegLinks, Shell} from '../../_components/Shell';
import {
  AssignSeatForm,
  LicenseButton,
  MarkReadButton,
  RaisePoForm,
  TaskMoveButton,
} from '../../_components/actions';
import {
  costLabel,
  isTeam,
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
  searchParams: Promise<{status?: string}>;
}) {
  const {team} = await params;
  if (!isTeam(team)) notFound();
  const {status = 'todo'} = await searchParams;
  const tab = TABS.find((t) => t.key === status) ?? TABS[0]!;

  const {repo, notifications: notifier} = await getServices();
  const [hires, allTasks, assets, assetCatalog, licenses, apps, inbox] =
    await Promise.all([
      repo.hires.list(),
      repo.tasks.where((t) => t.ownerTeam === team),
      repo.assets.where((a) => a.status === 'in_stock'),
      repo.assetCatalog.list(),
      repo.licenses.list(),
      repo.appCatalog.list(),
      notifier.forTeam(team),
    ]);
  const unreadCount = inbox.filter((n) => !n.read).length;
  const hireById = new Map(hires.map((h) => [h.id, h]));
  const appById = new Map(apps.map((a) => [a.id, a]));
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
  // Requested-but-never-granted seats (seeded as revoked with no grantedAt).
  const requested = licenses.filter(
    (l) => l.status === 'revoked' && l.grantedAt === null,
  );
  const base = `/team/${team}`;

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
          <PageHead eyebrow={`${teamLabel(team)} team`} title='Your queue' />
          <div>
            <SegLinks
              active={tab.key === 'todo' ? base : `${base}?status=${tab.key}`}
              options={TABS.map((t) => ({
                href: t.key === 'todo' ? base : `${base}?status=${t.key}`,
                label: `${t.label} · ${countFor(t.statuses)}`,
              }))}
            />
          </div>
          <section className='panel' style={{gap: 0, padding: '6px 20px 10px'}}>
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

          {team === "it" && (
            <section className="panel" style={{ padding: "16px 20px 20px" }}>
              <span className="panel-title" style={{ fontSize: 18 }}>
                Assign an extra seat
              </span>
              <AssignSeatForm
                hires={hires.map((h) => ({ id: h.id, name: h.name }))}
                apps={pools.map((p) => ({
                  id: p.appId,
                  name: p.name,
                  available: p.available,
                  monthlyCost: p.monthlyCost,
                }))}
              />
            </section>
          )}
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

          {team === 'it' && (
            <section
              className='turn'
              style={{
                background: 'var(--color-accent-100)',
                color: 'var(--color-accent-900)',
              }}
            >
              <span style={{fontWeight: 700, fontSize: 14}}>Seats waiting</span>
              {requested.length === 0 && (
                <span style={{fontSize: 13}}>
                  Every requested seat is granted.
                </span>
              )}
              {requested.map((l) => (
                <div
                  key={l.id}
                  className='row row-seat'
                  style={{padding: '4px 0', borderTop: 0}}
                >
                  <span style={{fontSize: 13}}>
                    {appById.get(l.appId)?.name} ·{' '}
                    {hireById.get(l.hireId)?.name}
                  </span>
                  <LicenseButton
                    action='grant'
                    label='Grant'
                    licenseIds={[l.id]}
                  />
                </div>
              ))}
              {requested.length > 1 && (
                <LicenseButton
                  className='btn btn-primary'
                  action='grant'
                  label={`Grant ${requested.length} seats`}
                  licenseIds={requested.map((l) => l.id)}
                />
              )}
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

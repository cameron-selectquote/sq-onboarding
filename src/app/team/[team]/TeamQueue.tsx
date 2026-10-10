'use client';

import {useCallback, useState} from 'react';
import {VIEW_LABELS, type QueueTeam} from '@/lib/access';
import {monthlyCost} from '@/lib/finance';
import type {TaskStatus} from '@/lib/types';
import {
  grantLicense,
  loadAssets,
  loadCatalog,
  loadHireDetails,
  raisePurchaseOrder,
  returnAsset,
  revokeLicense,
  updateTaskStatus,
} from '../../_components/api';
import {StatusBadge} from '../../_components/StatusBadge';
import {TaskRow} from '../../_components/TaskRow';
import {formatUsd} from '../../_components/format';
import {usePoll} from '../../_components/usePoll';

const POLL_MS = 5000;

/** Teams that handle hardware (PO + return). IT handles seats. */
const HARDWARE_TEAMS: ReadonlySet<QueueTeam> = new Set([
  'vendor',
  'facilities',
]);

export function TeamQueue({team}: {team: QueueTeam}) {
  const hires = usePoll(loadHireDetails, POLL_MS);
  const catalog = usePoll(loadCatalog);
  const assets = usePoll(loadAssets, POLL_MS);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshHires = hires.refresh;
  const refreshAssets = assets.refresh;

  /** Run an action, then refresh so totals and statuses move without reload. */
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setActionError(null);
      try {
        await action();
        await Promise.all([refreshHires(), refreshAssets()]);
      } catch (err) {
        setActionError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refreshHires, refreshAssets],
  );

  const details = hires.data ?? [];
  const hireName = new Map(details.map((d) => [d.hire.id, d.hire.name]));
  const appById = new Map((catalog.data?.apps ?? []).map((a) => [a.id, a]));
  const assetCatById = new Map(
    (catalog.data?.assetCatalog ?? []).map((a) => [a.id, a]),
  );

  const queue = details
    .flatMap((d) =>
      d.tasks
        .filter((t) => t.ownerTeam === team)
        .map((task) => ({task, hire: d.hire})),
    )
    .sort(
      (a, b) =>
        Number(a.task.status === 'done') - Number(b.task.status === 'done'),
    );
  const open = queue.filter((q) => q.task.status !== 'done').length;

  const licenses = details.flatMap((d) => d.licenses);
  const assignedAssets = (assets.data?.assets ?? []).filter(
    (a) => a.status === 'assigned',
  );

  return (
    <>
      <h1>{VIEW_LABELS[`team:${team}` as const]}</h1>
      {hires.error ?
        <p className='error' role='alert'>
          {hires.error}
        </p>
      : null}
      {actionError ?
        <p className='error' role='alert'>
          {actionError}
        </p>
      : null}

      <section className='panel' aria-labelledby='queue-heading'>
        <h2 id='queue-heading'>
          Tasks <span className='muted'>({open} open)</span>
        </h2>
        {!hires.data ?
          <p className='muted'>Loading…</p>
        : queue.length === 0 ?
          <p className='muted'>Nothing in the {team} queue.</p>
        : <ul className='task-list'>
            {queue.map(({task, hire}) => (
              <TaskRow
                key={task.id}
                task={task}
                subtitle={hire.name}
                disabled={busy === task.id}
                onStatusChange={(s: TaskStatus) =>
                  void run(task.id, () => updateTaskStatus(task.id, s))
                }
              >
                {task.costType === 'none' ? null : formatUsd(task.cost)}
              </TaskRow>
            ))}
          </ul>
        }
      </section>

      {team === 'it' ?
        <section className='panel' aria-labelledby='seats-heading'>
          <h2 id='seats-heading'>Seats</h2>
          {licenses.length === 0 ?
            <p className='muted'>
              No seats yet. Seats are created when a hire is imported with apps.
            </p>
          : <table>
              <thead>
                <tr>
                  <th scope='col'>Hire</th>
                  <th scope='col'>App</th>
                  <th scope='col'>Status</th>
                  <th scope='col' className='num'>
                    Monthly
                  </th>
                  <th scope='col'>Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => {
                  const app = appById.get(l.appId);
                  const appName = app?.name ?? l.appId;
                  const isActive = l.status === 'active';
                  return (
                    <tr key={l.id}>
                      <td>{hireName.get(l.hireId) ?? l.hireId}</td>
                      <td>{appName}</td>
                      <td>
                        <StatusBadge status={l.status} />
                      </td>
                      <td className='num'>
                        {app ?
                          formatUsd(monthlyCost(app.costPerSeat, app.billing))
                        : '—'}
                      </td>
                      <td>
                        <div className='actions' style={{marginTop: 0}}>
                          <button
                            type='button'
                            disabled={busy === l.id || isActive}
                            onClick={() =>
                              void run(l.id, () => grantLicense(l.id))
                            }
                            aria-label={`Grant ${appName} to ${hireName.get(l.hireId) ?? 'hire'}`}
                          >
                            Grant
                          </button>
                          <button
                            type='button'
                            className='secondary'
                            disabled={busy === l.id || l.status === 'revoked'}
                            onClick={() =>
                              void run(l.id, () => revokeLicense(l.id))
                            }
                            aria-label={`Revoke ${appName} from ${hireName.get(l.hireId) ?? 'hire'}`}
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          }
        </section>
      : null}

      {HARDWARE_TEAMS.has(team) ?
        <>
          <PurchaseOrderForm
            hires={details.map((d) => d.hire)}
            assetCatalog={catalog.data?.assetCatalog ?? []}
            busy={busy === 'po'}
            onSubmit={(input) => run('po', () => raisePurchaseOrder(input))}
            onHand={assets.data?.onHand}
          />
          <section className='panel' aria-labelledby='assets-heading'>
            <h2 id='assets-heading'>Assigned hardware</h2>
            {assignedAssets.length === 0 ?
              <p className='muted'>No assigned assets.</p>
            : <table>
                <thead>
                  <tr>
                    <th scope='col'>Asset</th>
                    <th scope='col'>Serial</th>
                    <th scope='col'>Hire</th>
                    <th scope='col'>Status</th>
                    <th scope='col'>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedAssets.map((a) => (
                    <tr key={a.id}>
                      <td>
                        {assetCatById.get(a.catalogId)?.name ?? a.catalogId}
                      </td>
                      <td>{a.serialTag}</td>
                      <td>
                        {a.assignedToHireId ?
                          (hireName.get(a.assignedToHireId) ??
                          a.assignedToHireId)
                        : '—'}
                      </td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                      <td>
                        <button
                          type='button'
                          className='secondary'
                          disabled={busy === a.id}
                          onClick={() =>
                            void run(a.id, () => returnAsset(a.id))
                          }
                          aria-label={`Return ${a.serialTag}`}
                        >
                          Return
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          </section>
        </>
      : null}
    </>
  );
}

function PurchaseOrderForm({
  hires,
  assetCatalog,
  busy,
  onSubmit,
  onHand,
}: {
  hires: {id: string; name: string}[];
  assetCatalog: {id: string; name: string; standardCost: number}[];
  busy: boolean;
  onSubmit: (input: {
    assetCatalogId: string;
    hireId: string;
    serialTag: string;
  }) => Promise<void>;
  onHand: number | undefined;
}) {
  const [hireId, setHireId] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const effectiveHire = hireId || hires[0]?.id || '';
  const effectiveCatalog = catalogId || assetCatalog[0]?.id || '';

  return (
    <section className='panel' aria-labelledby='po-heading'>
      <h2 id='po-heading'>
        Raise a PO{' '}
        {onHand !== undefined ?
          <span className='muted'>({onHand} in stock)</span>
        : null}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!effectiveHire || !effectiveCatalog) return;
          const serialTag = `PO-${Date.now().toString(36).toUpperCase()}`;
          void onSubmit({
            assetCatalogId: effectiveCatalog,
            hireId: effectiveHire,
            serialTag,
          });
        }}
      >
        <div className='form-grid'>
          <label className='field'>
            Hire
            <select
              value={effectiveHire}
              onChange={(e) => setHireId(e.target.value)}
            >
              {hires.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className='field'>
            Item
            <select
              value={effectiveCatalog}
              onChange={(e) => setCatalogId(e.target.value)}
            >
              {assetCatalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({formatUsd(c.standardCost)})
                </option>
              ))}
            </select>
          </label>
          <div className='field'>
            <button
              type='submit'
              disabled={busy || !effectiveHire || !effectiveCatalog}
            >
              Raise PO
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

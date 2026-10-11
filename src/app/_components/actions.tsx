'use client';

/**
 * The only client code in the role views. Each control calls an existing /api
 * route, then router.refresh() re-renders the server page with fresh data —
 * no business logic here, and no full reload (role-views AC #2, #3).
 */

import {useRouter} from 'next/navigation';
import {useState, useTransition, type ReactNode} from 'react';
import type {CostType, TaskStatus, Team} from '@/lib/types';
import {money} from './format';

async function send(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? {'Content-Type': 'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {error?: string};
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
}

/** Run requests in order, then refresh the page. Tracks pending + error. */
function useMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(requests: (() => Promise<void>)[]) {
    setBusy(true);
    setError(null);
    try {
      for (const request of requests) await request();
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return {run, pending: busy || pending, error};
}

/**
 * Wraps board content so a single click opens the hire detail page. A keyboard
 * Enter does the same.
 */
export function ClickCard({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div
      role='link'
      tabIndex={0}
      style={{cursor: 'pointer'}}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
    >
      {children}
    </div>
  );
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};

/** Board card status control — PATCH /api/tasks/:id. */
export function TaskStatusSelect({
  taskId,
  status,
}: {
  taskId: string;
  status: TaskStatus;
}) {
  const {run, pending, error} = useMutation();
  return (
    <>
      <select
        className='input status-select'
        aria-label='Task status'
        value={status}
        disabled={pending}
        onChange={(e) =>
          run([
            () =>
              send(`/api/tasks/${taskId}`, 'PATCH', {status: e.target.value}),
          ])
        }
      >
        {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && <span className='error'>{error}</span>}
    </>
  );
}

/** One-click status move for queue rows (Start / Mark done / Unblock). */
export function TaskMoveButton({
  taskId,
  to,
  label,
  primary,
}: {
  taskId: string;
  to: TaskStatus;
  label: string;
  primary?: boolean;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className={primary ? 'btn btn-primary' : 'btn btn-secondary'}
        style={{fontSize: 13}}
        disabled={pending}
        onClick={() =>
          run([() => send(`/api/tasks/${taskId}`, 'PATCH', {status: to})])
        }
      >
        {label}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

/** Grant or revoke one or more seats — POST /api/licenses/:id/{grant,revoke}. */
export function LicenseButton({
  licenseIds,
  action,
  label,
  className = 'btn btn-secondary',
}: {
  licenseIds: string[];
  action: 'grant' | 'revoke';
  label: string;
  className?: string;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className={className}
        disabled={pending || licenseIds.length === 0}
        onClick={() =>
          run(
            licenseIds.map(
              (id) => () => send(`/api/licenses/${id}/${action}`, 'POST'),
            ),
          )
        }
      >
        {pending ? 'Working…' : label}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

/** Mark one notification read — PATCH /api/notifications/:id/read. */
export function MarkReadButton({id}: {id: string}) {
  const {run, pending} = useMutation();
  return (
    <button
      className='btn btn-secondary'
      style={{fontSize: 12, padding: '2px 10px'}}
      disabled={pending}
      aria-label='Mark notification read'
      onClick={() =>
        run([() => send(`/api/notifications/${id}/read`, 'PATCH')])
      }
    >
      {pending ? '…' : 'Dismiss'}
    </button>
  );
}

/** Open a reclaim job per seat — POST /api/reclaim-tasks (finance flags, IT executes). */
export function ReclaimButton({
  licenseIds,
  createdByTeam,
  label,
  className = 'btn btn-secondary',
}: {
  licenseIds: string[];
  createdByTeam: 'finance' | 'it';
  label: string;
  className?: string;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className={className}
        disabled={pending || licenseIds.length === 0}
        onClick={() =>
          run(
            licenseIds.map(
              (id) => () =>
                send('/api/reclaim-tasks', 'POST', {
                  licenseId: id,
                  createdByTeam,
                }),
            ),
          )
        }
      >
        {pending ? 'Working…' : label}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

/** Drive one reclaim job — PATCH /api/reclaim-tasks/:id (Start / Mark done / Cancel). */
export function ReclaimJobButton({
  taskId,
  action,
  label,
  primary,
}: {
  taskId: string;
  action: 'start' | 'complete' | 'cancel';
  label: string;
  primary?: boolean;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className={primary ? 'btn btn-primary' : 'btn btn-secondary'}
        style={{fontSize: 13}}
        disabled={pending}
        onClick={() =>
          run([() => send(`/api/reclaim-tasks/${taskId}`, 'PATCH', {action})])
        }
      >
        {label}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

/**
 * Complete every open reclaim job — one PATCH /api/reclaim-tasks/:id
 * { action: 'complete' } per taskId, in order (mirrors LicenseButton's fan-out
 * over licenseIds). Each complete runs the real revoke + ledger credit.
 */
export function ReclaimAllButton({
  taskIds,
  label,
  className = 'btn btn-primary',
}: {
  taskIds: string[];
  label: string;
  className?: string;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className={className}
        disabled={pending || taskIds.length === 0}
        onClick={() =>
          run(
            taskIds.map(
              (id) => () =>
                send(`/api/reclaim-tasks/${id}`, 'PATCH', {action: 'complete'}),
            ),
          )
        }
      >
        {pending ? 'Working…' : label}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

/** Raise a PO for a hire — POST /api/pos. Serial tag is generated client-side. */
export function RaisePoForm({
  hires,
  catalog,
}: {
  hires: {id: string; name: string}[];
  catalog: {id: string; name: string}[];
}) {
  const {run, pending, error} = useMutation();
  const [hireId, setHireId] = useState(hires[0]?.id ?? '');
  const [assetCatalogId, setCatalogId] = useState(catalog[0]?.id ?? '');

  return (
    <form
      style={{display: 'flex', flexDirection: 'column', gap: 10}}
      onSubmit={(e) => {
        e.preventDefault();
        const serialTag = `PO-${assetCatalogId.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        run([
          () => send('/api/pos', 'POST', {assetCatalogId, hireId, serialTag}),
        ]);
      }}
    >
      <div className='field'>
        <label htmlFor='po-hire'>For</label>
        <select
          id='po-hire'
          className='input'
          value={hireId}
          onChange={(e) => setHireId(e.target.value)}
        >
          {hires.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>
      <div className='field'>
        <label htmlFor='po-item'>Item</label>
        <select
          id='po-item'
          className='input'
          value={assetCatalogId}
          onChange={(e) => setCatalogId(e.target.value)}
        >
          {catalog.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className='btn btn-primary'
        disabled={pending || !hireId || !assetCatalogId}
      >
        {pending ? 'Raising…' : 'Raise PO'}
      </button>
      {error && <span className='error'>{error}</span>}
    </form>
  );
}

/** Assign a new software seat to an existing hire — POST /api/licenses. */
export function AssignSeatForm({
  hires,
  apps,
}: {
  hires: {id: string; name: string}[];
  apps: {id: string; name: string; monthlyCost: number}[];
}) {
  const {run, pending, error} = useMutation();
  const [hireId, setHireId] = useState(hires[0]?.id ?? '');
  const [appId, setAppId] = useState(apps[0]?.id ?? '');

  const selected = apps.find((a) => a.id === appId);
  const monthly = selected?.monthlyCost ?? 0;
  const costText = `+${money(monthly)}/mo`;

  return (
    <form
      style={{display: 'flex', flexDirection: 'column', gap: 12}}
      onSubmit={(e) => {
        e.preventDefault();
        run([() => send('/api/licenses', 'POST', {hireId, appId})]);
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 12,
        }}
      >
        <div className='field' style={{flex: '1 1 180px'}}>
          <label htmlFor='seat-hire'>For</label>
          <select
            id='seat-hire'
            className='input'
            value={hireId}
            onChange={(e) => setHireId(e.target.value)}
          >
            {hires.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
        <div className='field' style={{flex: '1 1 180px'}}>
          <label htmlFor='seat-app'>Seat</label>
          <select
            id='seat-app'
            className='input'
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          >
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className='btn btn-primary'
          style={{flex: '0 0 auto'}}
          disabled={pending || !hireId || !appId}
        >
          {pending ? 'Assigning…' : 'Assign seat'}
        </button>
      </div>
      <div className='meter-head' style={{fontSize: 13, alignItems: 'center'}}>
        <span className='muted'>Adds to recurring burn</span>
        <span className='count'>{costText}</span>
      </div>
      {error && <span className='error'>{error}</span>}
    </form>
  );
}

/** Create a new role template — POST /api/templates. */
export function CreateTemplateForm() {
  const {run, pending, error} = useMutation();
  const [roleName, setRoleName] = useState('');

  return (
    <form
      style={{display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap'}}
      onSubmit={(e) => {
        e.preventDefault();
        if (!roleName.trim()) return;
        run([() => send('/api/templates', 'POST', {roleName})]);
        setRoleName('');
      }}
    >
      <div className='field' style={{flex: '1 1 220px'}}>
        <label htmlFor='tpl-role'>New role template</label>
        <input
          id='tpl-role'
          className='input'
          placeholder='e.g. Data Analyst'
          value={roleName}
          onChange={(e) => setRoleName(e.target.value)}
        />
      </div>
      <button
        className='btn btn-primary'
        style={{flex: '0 0 auto'}}
        disabled={pending || !roleName.trim()}
      >
        {pending ? 'Adding…' : 'Add template'}
      </button>
      {error && <span className='error'>{error}</span>}
    </form>
  );
}

const OWNER_TEAMS: {value: Team; label: string}[] = [
  {value: 'hr', label: 'HR'},
  {value: 'it', label: 'IT'},
  {value: 'vendor', label: 'Hardware'},
  {value: 'facilities', label: 'Facilities'},
  {value: 'finance', label: 'Finance'},
];

const COST_TYPES: {value: CostType; label: string}[] = [
  {value: 'none', label: 'No cost'},
  {value: 'one_time', label: 'One-time'},
  {value: 'recurring', label: 'Recurring / mo'},
];

/**
 * Add a task to a template — POST /api/templates/:id/tasks. Picking an app
 * makes the task grant that seat when a hire starts it; cost type "none" zeroes
 * the cost on the server regardless of what's typed.
 */
export function AddTemplateTaskForm({
  templateId,
  apps,
}: {
  templateId: string;
  apps: {id: string; name: string}[];
}) {
  const {run, pending, error} = useMutation();
  const [title, setTitle] = useState('');
  const [ownerTeam, setOwnerTeam] = useState<Team>('it');
  const [costType, setCostType] = useState<CostType>('none');
  const [cost, setCost] = useState('');
  const [appId, setAppId] = useState('');

  function reset() {
    setTitle('');
    setOwnerTeam('it');
    setCostType('none');
    setCost('');
    setAppId('');
  }

  return (
    <form
      className='tpl-task-form'
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        run([
          () =>
            send(`/api/templates/${templateId}/tasks`, 'POST', {
              title,
              ownerTeam,
              costType,
              cost: costType === 'none' ? 0 : Number(cost) || 0,
              appId: appId || null,
            }),
        ]);
        reset();
      }}
    >
      <div className='field' style={{flex: '2 1 200px'}}>
        <label>Task</label>
        <input
          className='input'
          placeholder='e.g. Grant GitHub seat'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className='field' style={{flex: '1 1 120px'}}>
        <label>Owner</label>
        <select
          className='input'
          value={ownerTeam}
          onChange={(e) => setOwnerTeam(e.target.value as Team)}
        >
          {OWNER_TEAMS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className='field' style={{flex: '1 1 130px'}}>
        <label>Cost type</label>
        <select
          className='input'
          value={costType}
          onChange={(e) => setCostType(e.target.value as CostType)}
        >
          {COST_TYPES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className='field' style={{flex: '0 1 100px'}}>
        <label>Cost</label>
        <input
          className='input'
          type='number'
          min='0'
          step='1'
          placeholder='0'
          value={cost}
          disabled={costType === 'none'}
          onChange={(e) => setCost(e.target.value)}
        />
      </div>
      <div className='field' style={{flex: '1 1 140px'}}>
        <label>Grants seat</label>
        <select
          className='input'
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
        >
          <option value=''>None</option>
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <button
        className='btn btn-primary'
        style={{flex: '0 0 auto'}}
        disabled={pending || !title.trim()}
      >
        {pending ? 'Adding…' : 'Add task'}
      </button>
      {error && <span className='error' style={{flexBasis: '100%'}}>{error}</span>}
    </form>
  );
}

/** Remove a template task — DELETE /api/templates/:id/tasks/:taskId. */
export function RemoveTemplateTaskButton({
  templateId,
  taskId,
}: {
  templateId: string;
  taskId: string;
}) {
  const {run, pending, error} = useMutation();
  return (
    <span>
      <button
        className='btn btn-ghost'
        style={{fontSize: 13}}
        disabled={pending}
        aria-label='Remove task'
        onClick={() =>
          run([
            () =>
              send(`/api/templates/${templateId}/tasks/${taskId}`, 'DELETE'),
          ])
        }
      >
        {pending ? '…' : 'Remove'}
      </button>
      {error && <span className='error'> {error}</span>}
    </span>
  );
}

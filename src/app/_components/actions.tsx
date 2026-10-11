'use client';

/**
 * The only client code in the role views. Each control calls an existing /api
 * route, then router.refresh() re-renders the server page with fresh data —
 * no business logic here, and no full reload (role-views AC #2, #3).
 */

import {useRouter} from 'next/navigation';
import {useState, useTransition, type ReactNode} from 'react';
import type {TaskStatus} from '@/lib/types';

async function send(
  url: string,
  method: 'POST' | 'PATCH',
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

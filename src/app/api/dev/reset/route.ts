import {NextResponse} from 'next/server';
import {canResetStore} from '@/lib/access';
import {currentSession} from '@/server/auth';
import {resetStore} from '@/server/store';

/**
 * POST /api/dev/reset — wipe the store and reload the committed seed.
 *
 * Returns the data to its first-boot baseline (red reclaim banner) for
 * re-running the demo. The current DB is snapshotted first (path returned as
 * `backup`). In dev any signed-in, API-capable account may call it; in
 * production only a real admin (see `canResetStore`).
 */
export async function POST() {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({error: 'Not signed in'}, {status: 401});
  }
  if (!canResetStore(session.role, process.env.NODE_ENV === 'production')) {
    return NextResponse.json({error: 'Forbidden'}, {status: 403});
  }

  const summary = await resetStore();
  return NextResponse.json(summary, {status: 200});
}

import {NextResponse} from 'next/server';
import {resetStore} from '@/server/store';

/**
 * POST /api/dev/reset — DEV ONLY.
 *
 * Wipes the store and reloads the committed seed, returning the data to its
 * first-boot baseline (red reclaim banner). A temporary convenience for
 * re-running the demo from a clean slate; refused in production so it can't
 * touch real data.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({error: 'not found'}, {status: 404});
  }

  const summary = await resetStore();
  return NextResponse.json(summary, {status: 200});
}

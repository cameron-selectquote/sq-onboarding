import {NextResponse} from 'next/server';
import {getServices} from '@/server/store';

/** PATCH /api/notifications/:id/read — mark one notification read. */
export async function PATCH(
  _req: Request,
  {params}: {params: Promise<{id: string}>},
) {
  const {id} = await params;
  const {notifications} = await getServices();
  try {
    const updated = await notifications.markRead(id);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({error: (err as Error).message}, {status: 404});
  }
}

import {NextResponse} from 'next/server';
import {getServices} from '@/server/store';
import {isTeam} from '@/app/_components/format';

/**
 * GET /api/notifications?team=it — a team's inbox (unread first) + unread count.
 * Thin: parses the team param, delegates to NotificationService.
 */
export async function GET(req: Request) {
  const {searchParams} = new URL(req.url);
  const team = searchParams.get('team') ?? undefined;
  if (!isTeam(team)) {
    return NextResponse.json(
      {error: 'team is required (hr|it|vendor|facilities|finance)'},
      {status: 400},
    );
  }

  const {notifications} = await getServices();
  const [items, unread] = await Promise.all([
    notifications.forTeam(team),
    notifications.unreadCount(team),
  ]);
  return NextResponse.json({team, unread, notifications: items});
}

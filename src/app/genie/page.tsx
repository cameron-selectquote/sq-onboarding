import {redirect} from 'next/navigation';
import {currentSession} from '@/server/auth';
import {PageHead, Shell} from '../_components/Shell';
import {GenieChat} from '../_components/genie';

export const dynamic = 'force-dynamic';

/**
 * The shared, role-scoped Genie for managers and new hires. The agent, its
 * persona, and its tools are chosen server-side from the session role (see
 * resolveGenieContext + /api/genie), so this page just renders the chat.
 *
 * Admins have the richer onboarding Genie at /specialist/genie, so they're
 * sent there rather than seeing the slimmed-down shared one.
 */
export default async function GeniePage() {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (session.viewAs === 'admin') redirect('/specialist/genie');

  const eyebrow =
    session.viewAs === 'manager' ?
      'Assistant · your team'
    : 'Assistant · your onboarding';

  return (
    <Shell active='/genie' fill>
      <PageHead eyebrow={eyebrow} title='Genie' />
      <GenieChat />
    </Shell>
  );
}

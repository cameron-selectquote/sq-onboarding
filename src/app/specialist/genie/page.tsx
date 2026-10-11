import {getServices} from '@/server/store';
import {PageHead, Shell} from '../../_components/Shell';
import {GenieChat} from '../../_components/genie';
import {SPECIALIST_NAV} from '../nav';

export const dynamic = 'force-dynamic';

/**
 * Onboarding Genie — a Strands Agents (Bedrock) agent that walks HR/managers
 * from a candidate name to a published 30-day onboarding plan. Lives on the
 * specialist (HR) side, not the new-hire view.
 *
 * `?candidate=<id>` (from the "Run Genie" button on the candidates page) opens
 * the chat already focused on that person.
 */
export default async function GeniePage({
  searchParams,
}: {
  searchParams: Promise<{candidate?: string}>;
}) {
  const {candidate} = await searchParams;
  let initialName: string | undefined;
  if (candidate) {
    const {repo} = await getServices();
    const found = await repo.candidates.get(candidate);
    initialName = found?.name;
  }

  return (
    <Shell
      nav={SPECIALIST_NAV}
      active='/specialist/genie'
      who='Specialist · HR'
    >
      <PageHead eyebrow='AI · Strands Agents' title='Onboarding Genie' />
      {/* key on the candidate so switching candidates starts a fresh chat */}
      <GenieChat key={candidate ?? 'blank'} initialName={initialName} />
    </Shell>
  );
}

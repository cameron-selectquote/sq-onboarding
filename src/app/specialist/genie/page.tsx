import {getServices} from '@/server/store';
import {PageHead, Shell} from '../../_components/Shell';
import {GenieChat} from '../../_components/genie';

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
    <Shell active='/specialist/genie' fill>
      <PageHead eyebrow='AI · Strands Agents' title='Sage' />
      {/* key on the candidate so switching candidates starts a fresh chat */}
      <GenieChat key={candidate ?? 'blank'} initialName={initialName} />
    </Shell>
  );
}

import { PageHead, Shell } from "../../_components/Shell";
import { GenieChat } from "../../_components/genie";
import { SPECIALIST_NAV } from "../nav";

export const dynamic = "force-dynamic";

/**
 * Onboarding Genie — a Strands Agents (Bedrock) agent that walks HR/managers
 * from a candidate name to a published 30-day onboarding plan. Lives on the
 * specialist (HR) side, not the new-hire view.
 */
export default function GeniePage() {
  return (
    <Shell nav={SPECIALIST_NAV} active="/specialist/genie" who="Specialist · HR">
      <PageHead
        eyebrow="AI · Strands Agents"
        title="Onboarding Genie"
      />
      <GenieChat />
    </Shell>
  );
}

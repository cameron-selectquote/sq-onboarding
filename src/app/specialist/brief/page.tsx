import { getServices } from "@/server/store";
import { PageHead, Shell } from "../../_components/Shell";
import { BriefDrafter } from "../../_components/brief";
import { SPECIALIST_NAV } from "../nav";

export const dynamic = "force-dynamic";

/**
 * Access brief (BuildPlan §4 "Access brief", §3 /api/ai/draft-brief). A
 * specialist picks a hire and the AI drafts welcome blurbs from that hire's
 * granted seats. The second of the two product AI calls, now visible in the UI.
 */
export default async function SpecialistBrief() {
  const { repo } = await getServices();
  const hires = await repo.hires.list();

  return (
    <Shell nav={SPECIALIST_NAV} active="/specialist/brief" who="Specialist · HR">
      <PageHead
        eyebrow="AI · welcome brief"
        title="Draft a hire's access brief"
      />
      <BriefDrafter hires={hires.map((h) => ({ id: h.id, name: h.name }))} />
    </Shell>
  );
}

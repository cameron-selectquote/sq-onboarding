import { notFound } from "next/navigation";
import { VIEW_LABELS, canAccess, isQueueTeam } from "@/lib/access";
import { NoAccess } from "../../_components/NoAccess";
import { getPersona } from "../../_components/persona";
import { TeamQueue } from "./TeamQueue";

export default async function TeamPage({ params }: { params: Promise<{ team: string }> }) {
  const { team } = await params;
  if (!isQueueTeam(team)) notFound();
  const view = `team:${team}` as const;
  const persona = await getPersona();
  if (!canAccess(persona, view)) return <NoAccess persona={persona} view={VIEW_LABELS[view]} />;
  return <TeamQueue team={team} />;
}

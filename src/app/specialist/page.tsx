import { canAccess } from "@/lib/access";
import { NoAccess } from "../_components/NoAccess";
import { getPersona } from "../_components/persona";
import { SpecialistBoard } from "./SpecialistBoard";

export default async function SpecialistPage() {
  const persona = await getPersona();
  if (!canAccess(persona, "specialist")) return <NoAccess persona={persona} view="Specialist board" />;
  return <SpecialistBoard />;
}

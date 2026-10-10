import { canAccess } from "@/lib/access";
import { NoAccess } from "../_components/NoAccess";
import { getPersona } from "../_components/persona";
import { ManagerReport } from "./ManagerReport";

export default async function ManagerPage() {
  const persona = await getPersona();
  if (!canAccess(persona, "manager")) return <NoAccess persona={persona} view="Manager report" />;
  return <ManagerReport />;
}

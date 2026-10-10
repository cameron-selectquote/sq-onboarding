import { canAccess } from "@/lib/access";
import { NoAccess } from "../_components/NoAccess";
import { getPersona } from "../_components/persona";
import { FinanceDashboard } from "./FinanceDashboard";

export default async function FinancePage() {
  const persona = await getPersona();
  if (!canAccess(persona, "finance")) return <NoAccess persona={persona} view="Finance" />;
  return <FinanceDashboard />;
}

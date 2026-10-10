import { canAccess } from "@/lib/access";
import { NoAccess } from "../_components/NoAccess";
import { getPersona } from "../_components/persona";
import { MyOnboarding } from "./MyOnboarding";

/** Until real auth lands, the hire is picked by ?hire= (defaults to the first seeded hire). */
const DEFAULT_HIRE_ID = "hire_1";

export default async function MyOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ hire?: string | string[] }>;
}) {
  const persona = await getPersona();
  if (!canAccess(persona, "myonboarding")) return <NoAccess persona={persona} view="My onboarding" />;
  const { hire } = await searchParams;
  const hireId = (Array.isArray(hire) ? hire[0] : hire) || DEFAULT_HIRE_ID;
  return <MyOnboarding hireId={hireId} />;
}

import { cookies } from "next/headers";
import { PERSONA_COOKIE, parsePersona, type Persona } from "@/lib/access";

/** Server-only: the current persona from the role-selector cookie. */
export async function getPersona(): Promise<Persona> {
  const store = await cookies();
  return parsePersona(store.get(PERSONA_COOKIE)?.value);
}

import Link from "next/link";
import { PERSONA_LABELS, homePathFor, type Persona } from "@/lib/access";

/** Rendered instead of a view's content (and data) when the persona lacks access. */
export function NoAccess({ persona, view }: { persona: Persona; view: string }) {
  return (
    <section className="panel no-access" role="alert">
      <h1>No access</h1>
      <p>
        The {PERSONA_LABELS[persona]} role can&apos;t open the {view} view.
      </p>
      <p>
        <Link href={homePathFor(persona)}>Go to your view</Link>
      </p>
    </section>
  );
}

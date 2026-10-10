import Link from "next/link";
import { VIEW_LABELS, VIEW_PATHS, viewsFor, type Persona } from "@/lib/access";
import { RoleSelector } from "./RoleSelector";

/** Top bar: brand, the views the current persona may open, role switcher. */
export function Nav({ persona }: { persona: Persona }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        Provision
      </Link>
      <nav aria-label="Role views">
        <ul>
          {viewsFor(persona).map((v) => (
            <li key={v}>
              <Link href={VIEW_PATHS[v]}>{VIEW_LABELS[v]}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <RoleSelector current={persona} />
    </header>
  );
}

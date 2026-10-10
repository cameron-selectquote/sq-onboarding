"use client";

import { useRouter } from "next/navigation";
import {
  PERSONAS,
  PERSONA_COOKIE,
  PERSONA_LABELS,
  homePathFor,
  isPersona,
  type Persona,
} from "@/lib/access";

/**
 * First-pass role switcher (no real auth). Writes the persona cookie that
 * server pages read, then lands on that persona's home view.
 */
export function RoleSelector({ current }: { current: Persona }) {
  const router = useRouter();

  function onChange(value: string) {
    if (!isPersona(value)) return;
    document.cookie = `${PERSONA_COOKIE}=${value}; path=/; max-age=86400; samesite=lax`;
    router.push(homePathFor(value));
    router.refresh();
  }

  return (
    <div className="role-selector">
      <label htmlFor="persona-select">Viewing as</label>
      <select
        id="persona-select"
        value={current}
        onChange={(e) => onChange(e.target.value)}
      >
        {PERSONAS.map((p) => (
          <option key={p} value={p}>
            {PERSONA_LABELS[p]}
          </option>
        ))}
      </select>
    </div>
  );
}

"use client";

import { useState } from "react";
import { ROLES, ROLE_LABELS, type AppRole } from "@/lib/access";

/**
 * Admin-only role picker. A plain form post to /api/session/view-as (the
 * server re-checks the admin role); client state only toggles the employee
 * selector.
 */
export function RolePicker({
  viewAs,
  hireId,
  hires,
}: {
  viewAs: AppRole;
  hireId: string | null;
  hires: { id: string; name: string }[];
}) {
  const [role, setRole] = useState<AppRole>(viewAs);

  return (
    <form method="post" action="/api/session/view-as" className="role-picker">
      <div className="field">
        <label htmlFor="viewAs">View as</label>
        <select id="viewAs" name="viewAs" className="input" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {role === "employee" && (
        <div className="field">
          <label htmlFor="hireId">Employee</label>
          <select id="hireId" name="hireId" className="input" defaultValue={hireId ?? hires[0]?.id}>
            {hires.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" className="btn btn-secondary btn-block">
        Switch
      </button>
    </form>
  );
}

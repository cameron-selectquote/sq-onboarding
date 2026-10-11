/**
 * Demo sign-in accounts (login-home spec). One per role, all sharing the
 * DEMO_PASSWORD. Deliberately in code, not the users table: there is no real
 * identity provider yet. The employee account is tied to a seeded hire.
 *
 * Pure — no framework, no I/O.
 */
import type { AppRole } from "./access";

export interface DemoAccount {
  username: string;
  name: string;
  role: AppRole;
  /** Set only for the employee account: whose checklist they see. */
  hireId: string | null;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: "admin", name: "Avery Admin", role: "admin", hireId: null },
  { username: "manager", name: "Morgan Manager", role: "manager", hireId: null },
  { username: "employee", name: "Riley Chen", role: "employee", hireId: "hire_1" },
];

export function findAccount(username: string): DemoAccount | null {
  const key = username.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.username === key) ?? null;
}

/**
 * Role-based access policy (login-home spec).
 *
 * The viewing role comes from the signed demo session (see session.ts and
 * src/middleware.ts). This module is the single place that decides which role
 * may open which view and what the sidebar lists, so a real identity provider
 * can later swap the role source without touching the rules.
 *
 * Pure — no framework, no cookies, no network.
 */
import type { Team } from "./types";

export const ROLES = ["admin", "manager", "employee"] as const;
export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

/** Teams that have a work queue view. */
export const QUEUE_TEAMS = ["it", "vendor", "facilities"] as const satisfies readonly Team[];
export type QueueTeam = (typeof QUEUE_TEAMS)[number];

export type View =
  | "home"
  | "specialist"
  | "finance"
  | "manager"
  | "myonboarding"
  | "api-docs"
  | `team:${QueueTeam}`;

export const VIEW_PATHS: Record<View, string> = {
  home: "/home",
  specialist: "/specialist",
  finance: "/finance",
  manager: "/manager",
  myonboarding: "/myonboarding",
  "api-docs": "/api-docs",
  "team:it": "/team/it",
  "team:vendor": "/team/vendor",
  "team:facilities": "/team/facilities",
};

const teamViews = QUEUE_TEAMS.map((t) => `team:${t}` as const);

/**
 * Views each role may open.
 * - Admin runs everything, including the money view.
 * - Manager reports on their hires' progress (no costs).
 * - Employee sees only their own checklist (no costs, no API).
 */
const ACCESS: Record<AppRole, readonly View[]> = {
  admin: ["home", "specialist", "finance", ...teamViews, "manager", "myonboarding", "api-docs"],
  manager: ["home", "manager"],
  employee: ["home", "myonboarding"],
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isQueueTeam(value: unknown): value is QueueTeam {
  return typeof value === "string" && (QUEUE_TEAMS as readonly string[]).includes(value);
}

export function viewsFor(role: AppRole): readonly View[] {
  return ACCESS[role];
}

export function canAccess(role: AppRole, view: View): boolean {
  return ACCESS[role].includes(view);
}

/** Everyone lands on the home dashboard (kept per-role so that can change later). */
export function homePathFor(role: AppRole): string {
  return canAccess(role, "home") ? VIEW_PATHS.home : "/login";
}

/** The view a page path belongs to, or null if it isn't a known view. */
export function viewForPath(pathname: string): View | null {
  const views = Object.entries(VIEW_PATHS) as [View, string][];
  const match = views.find(([, base]) => pathname === base || pathname.startsWith(`${base}/`));
  return match ? match[0] : null;
}

/**
 * May this role open this page? Known views follow ACCESS. Unknown paths (which
 * 404 anyway) are closed to employees so nothing new leaks by default.
 */
export function canOpenPath(role: AppRole, pathname: string): boolean {
  const view = viewForPath(pathname);
  return view ? canAccess(role, view) : role !== "employee";
}

/**
 * May this role call the API? The API returns costs, and the employee view
 * must never see them. (Public auth routes are allowed before this check.)
 */
export function canCallApi(role: AppRole): boolean {
  return role !== "employee";
}

/** Only a real admin gets the role picker. */
export function canSwitchRole(realRole: AppRole): boolean {
  return realRole === "admin";
}

export interface NavLink {
  href: string;
  label: string;
}
export interface NavSection {
  /** Section heading; null for the top (ungrouped) links. */
  title: string | null;
  items: NavLink[];
}

/** Sidebar sections, each gated by the view it belongs to. */
const NAV: { title: string | null; view: View; items: NavLink[] }[] = [
  { title: null, view: "home", items: [{ href: "/home", label: "Home" }] },
  {
    title: "Onboarding",
    view: "specialist",
    items: [
      { href: "/specialist", label: "Board" },
      { href: "/specialist/hires", label: "Hires" },
      { href: "/specialist/candidates", label: "Candidates" },
      { href: "/specialist/genie", label: "Genie" },
      { href: "/specialist/brief", label: "Access brief" },
    ],
  },
  {
    title: "Finance",
    view: "finance",
    items: [
      { href: "/finance", label: "Overview" },
      { href: "/finance/reclaim", label: "Reclaim" },
    ],
  },
  { title: "Queues", view: "team:it", items: [{ href: "/team/it", label: "IT" }] },
  { title: "Queues", view: "team:vendor", items: [{ href: "/team/vendor", label: "Hardware" }] },
  { title: "Queues", view: "team:facilities", items: [{ href: "/team/facilities", label: "Facilities" }] },
  { title: "People", view: "manager", items: [{ href: "/manager", label: "My hires" }] },
  { title: "People", view: "myonboarding", items: [{ href: "/myonboarding", label: "My onboarding" }] },
  { title: "Developer", view: "api-docs", items: [{ href: "/api-docs", label: "API docs" }] },
];

/** The sidebar for a role: allowed entries only, merged by section title. */
export function navFor(role: AppRole): NavSection[] {
  const sections: NavSection[] = [];
  for (const entry of NAV) {
    if (!canAccess(role, entry.view)) continue;
    const last = sections[sections.length - 1];
    if (last && last.title === entry.title) last.items.push(...entry.items);
    else sections.push({ title: entry.title, items: [...entry.items] });
  }
  return sections;
}

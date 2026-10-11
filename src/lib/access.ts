/**
 * Role-view access policy (role-views spec, AC #5).
 *
 * The current persona comes from the signed demo session (see session.ts and
 * src/middleware.ts). This module is the single place that decides which
 * persona may open which view, so a real identity provider can later swap the
 * persona source without touching the rules.
 *
 * Pure — no framework, no cookies, no network.
 */
import type { Team } from "./types";

export const PERSONAS = [
  "specialist",
  "manager",
  "finance",
  "it",
  "vendor",
  "facilities",
  "hire",
] as const;
export type Persona = (typeof PERSONAS)[number];

/** Used when no (or an unknown) persona cookie is set. */
export const DEFAULT_PERSONA: Persona = "specialist";

/** Teams that have a work queue view. */
export const QUEUE_TEAMS = ["it", "vendor", "facilities"] as const satisfies readonly Team[];
export type QueueTeam = (typeof QUEUE_TEAMS)[number];

export type View =
  | "specialist"
  | "finance"
  | "manager"
  | "myonboarding"
  | `team:${QueueTeam}`;

export const PERSONA_LABELS: Record<Persona, string> = {
  specialist: "Specialist",
  manager: "Manager",
  finance: "Finance",
  it: "IT team",
  vendor: "Hardware team",
  facilities: "Facilities team",
  hire: "New hire",
};

export const VIEW_LABELS: Record<View, string> = {
  specialist: "Board",
  finance: "Finance",
  manager: "Manager report",
  myonboarding: "My onboarding",
  "team:it": "IT queue",
  "team:vendor": "Hardware queue",
  "team:facilities": "Facilities queue",
};

export const VIEW_PATHS: Record<View, string> = {
  specialist: "/specialist",
  finance: "/finance",
  manager: "/manager",
  myonboarding: "/myonboarding",
  "team:it": "/team/it",
  "team:vendor": "/team/vendor",
  "team:facilities": "/team/facilities",
};

const teamViews = QUEUE_TEAMS.map((t) => `team:${t}` as const);

/**
 * Views each persona may open, in nav order. The first entry is the persona's
 * home view.
 *
 * - Specialist runs onboarding: the board, every team queue, the manager
 *   report, and a (cost-free) preview of the new-hire checklist.
 * - Finance is the only persona with the money view.
 * - A new hire sees only their own checklist.
 */
const ACCESS: Record<Persona, readonly View[]> = {
  specialist: ["specialist", ...teamViews, "manager", "myonboarding"],
  manager: ["manager"],
  finance: ["finance"],
  it: ["team:it"],
  vendor: ["team:vendor"],
  facilities: ["team:facilities"],
  hire: ["myonboarding"],
};

export function isPersona(value: unknown): value is Persona {
  return typeof value === "string" && (PERSONAS as readonly string[]).includes(value);
}

export function isQueueTeam(value: unknown): value is QueueTeam {
  return typeof value === "string" && (QUEUE_TEAMS as readonly string[]).includes(value);
}

/** Normalize a raw cookie value to a persona, falling back to the default. */
export function parsePersona(value: string | undefined | null): Persona {
  return isPersona(value) ? value : DEFAULT_PERSONA;
}

export function viewsFor(persona: Persona): readonly View[] {
  return ACCESS[persona];
}

export function canAccess(persona: Persona, view: View): boolean {
  return ACCESS[persona].includes(view);
}

/** The path a persona lands on after switching roles. */
export function homePathFor(persona: Persona): string {
  const [home] = ACCESS[persona];
  return home ? VIEW_PATHS[home] : "/";
}

/** The role view a page path belongs to, or null for shared pages (e.g. /api-docs). */
export function viewForPath(pathname: string): View | null {
  const views = Object.entries(VIEW_PATHS) as [View, string][];
  const match = views.find(([, base]) => pathname === base || pathname.startsWith(`${base}/`));
  return match ? match[0] : null;
}

/**
 * May this persona open this page? Role views follow ACCESS; shared pages are
 * staff-only. A new hire gets their checklist and nothing else.
 */
export function canOpenPath(persona: Persona, pathname: string): boolean {
  const view = viewForPath(pathname);
  return view ? canAccess(persona, view) : persona !== "hire";
}

/**
 * May this persona call this API route? Staff may call any of them. A new hire
 * may call none: the API returns costs, and the hire view must never see them.
 * (The public auth routes are allowed before this check runs.)
 */
export function canCallApi(persona: Persona): boolean {
  return persona !== "hire";
}

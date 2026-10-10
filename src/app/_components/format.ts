import type { CostType, Team } from "@/lib/types";

const TEAM_LABEL: Record<Team, string> = {
  hr: "HR",
  it: "IT",
  vendor: "Vendor",
  facilities: "Facilities",
  finance: "Finance",
};

/** Design's tag color per owner team. */
const TEAM_TAG: Record<Team, string> = {
  hr: "tag tag-accent",
  it: "tag tag-accent-2",
  vendor: "tag tag-neutral",
  facilities: "tag tag-outline",
  finance: "tag tag-neutral",
};

export const TEAMS = Object.keys(TEAM_LABEL) as Team[];

export function teamLabel(team: Team): string {
  return TEAM_LABEL[team];
}

export function teamTag(team: Team): string {
  return TEAM_TAG[team];
}

export function isTeam(value: string | undefined): value is Team {
  return value !== undefined && value in TEAM_LABEL;
}

/** "$1,450", "$12.50", "−$120" — cents only when there are cents. */
export function money(amount: number): string {
  const abs = Math.abs(amount);
  const text = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `−${text}` : text;
}

/** Task cost as the queues show it: "$21/mo", "$2,800", or "—". */
export function costLabel(cost: number, costType: CostType): string {
  if (costType === "none" || cost === 0) return "—";
  return costType === "recurring" ? `${money(cost)}/mo` : money(cost);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** "Feb 2" from an ISO date. */
export function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Monday, Feb 2" from an ISO date. */
export function longDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** "2m ago", "3h ago", "Yesterday", "Feb 2". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return shortDate(iso);
}

/**
 * Seat-pool derivations (software licensing capacity).
 *
 * Answers "how many seats do we own for each app, and how many are in use" —
 * e.g. 1000 Amazon Workspace seats owned, 327 assigned, 673 available.
 *
 * Pure functions over plain records: no DB, no clock, no network. The owned
 * count comes from `AppCatalogItem.seatsOwned`; the assigned count is derived
 * from the live `license` rows, so it stays correct as seats are granted and
 * revoked without storing a second source of truth.
 */

import { monthlyCost } from "./finance";
import type { AppCatalogItem, License } from "./types";

export interface SeatPool {
  appId: string;
  name: string;
  /** Total seats the company owns for this app. */
  owned: number;
  /** Seats currently consumed by a hire. */
  assigned: number;
  /** owned - assigned, never below zero. */
  available: number;
  /** Recurring monthly cost of one seat (billing normalized to monthly). */
  monthlyCost: number;
}

/**
 * License statuses that still consume a seat. Idle and reclaim seats are still
 * held (and paid for) until actually revoked, so they count as assigned. Only
 * `revoked` frees a seat back to the pool.
 */
const CONSUMING_STATUSES: ReadonlySet<License["status"]> = new Set([
  "active",
  "idle",
  "reclaim",
]);

/**
 * Seats consumed for an app: the pre-existing company baseline plus the live
 * onboarding `license` rows (active/idle/reclaim). This is the single source
 * both the utilization display and the capacity guard use, so they can't drift.
 */
export function assignedSeats(app: AppCatalogItem, licenses: License[]): number {
  const fromLicenses = licenses.filter(
    (l) => l.appId === app.id && CONSUMING_STATUSES.has(l.status),
  ).length;
  return (app.seatsInUseBaseline ?? 0) + fromLicenses;
}

/** Build the owned / assigned / available pool for every app in the catalog. */
export function seatPools(
  apps: AppCatalogItem[],
  licenses: License[],
): SeatPool[] {
  return apps.map((app) => {
    const owned = app.seatsOwned ?? 0;
    const assigned = assignedSeats(app, licenses);
    return {
      appId: app.id,
      name: app.name,
      owned,
      assigned,
      available: Math.max(owned - assigned, 0),
      monthlyCost: monthlyCost(app.costPerSeat, app.billing),
    };
  });
}

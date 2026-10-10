/**
 * Reclaim rules (BuildPlan §4 data-eng workstream).
 *
 * Flags recoverable spend so the "reclaim banner goes green" demo beat has real
 * logic behind it:
 *   - idle:          an active license unused for more than N days
 *   - duplicate:     a hire holds >1 active license in the same app category
 *   - role_mismatch: a hire holds a license outside their role's allowed stack
 *   - pending_return: an assigned asset for an offboarding hire
 *
 * Pure functions over plain records. No DB, no clock dependency except the
 * `asOf` you pass in (defaults to now, override in tests).
 */

import type { AppCatalogItem, Asset, License } from "./types";

export type ReclaimReason =
  | "idle"
  | "duplicate"
  | "role_mismatch"
  | "pending_return";

export interface LicenseReclaimFlag {
  kind: "license";
  licenseId: string;
  hireId: string;
  appId: string;
  reason: ReclaimReason;
  detail: string;
}

export interface AssetReclaimFlag {
  kind: "asset";
  assetId: string;
  hireId: string;
  reason: ReclaimReason;
  detail: string;
}

export type ReclaimFlag = LicenseReclaimFlag | AssetReclaimFlag;

export interface ReclaimOptions {
  /** A license unused for more than this many days is "idle". */
  idleDays?: number;
  /** Evaluation time; defaults to now. Injectable for deterministic tests. */
  asOf?: Date;
  /**
   * Optional map of roleName -> allowed app ids. When provided, a hire holding
   * an app outside their role's set is flagged role_mismatch.
   */
  allowedAppsByRole?: Record<string, ReadonlySet<string>>;
  /** roleName per hire, needed for role_mismatch checks. */
  roleByHireId?: Record<string, string>;
}

const DEFAULT_IDLE_DAYS = 30;

/** Flag active licenses that look reclaimable. */
export function flagLicenses(
  licenses: License[],
  apps: AppCatalogItem[],
  options: ReclaimOptions = {},
): LicenseReclaimFlag[] {
  const idleDays = options.idleDays ?? DEFAULT_IDLE_DAYS;
  const asOf = options.asOf ?? new Date();
  const appById = new Map(apps.map((a) => [a.id, a]));

  const flags: LicenseReclaimFlag[] = [];
  const active = licenses.filter((l) => l.status === "active");

  // idle
  for (const license of active) {
    const idleFor = daysSince(license.lastUsedAt, asOf);
    if (idleFor !== null && idleFor > idleDays) {
      flags.push({
        kind: "license",
        licenseId: license.id,
        hireId: license.hireId,
        appId: license.appId,
        reason: "idle",
        detail: `Unused for ${Math.floor(idleFor)} days (threshold ${idleDays})`,
      });
    }
  }

  // duplicate — more than one active license in the same category for one hire
  const byHire = groupBy(active, (l) => l.hireId);
  for (const [, hireLicenses] of byHire) {
    const byCategory = groupBy(hireLicenses, (l) => {
      const app = appById.get(l.appId);
      return app ? app.category : "__unknown__";
    });
    for (const [category, group] of byCategory) {
      if (category === "__unknown__" || group.length <= 1) continue;
      // Keep the first, flag the rest as duplicates.
      for (const license of group.slice(1)) {
        flags.push({
          kind: "license",
          licenseId: license.id,
          hireId: license.hireId,
          appId: license.appId,
          reason: "duplicate",
          detail: `Second active license in category "${category}"`,
        });
      }
    }
  }

  // role_mismatch
  if (options.allowedAppsByRole && options.roleByHireId) {
    for (const license of active) {
      const role = options.roleByHireId[license.hireId];
      if (!role) continue;
      const allowed = options.allowedAppsByRole[role];
      if (allowed && !allowed.has(license.appId)) {
        flags.push({
          kind: "license",
          licenseId: license.id,
          hireId: license.hireId,
          appId: license.appId,
          reason: "role_mismatch",
          detail: `App not in allowed stack for role "${role}"`,
        });
      }
    }
  }

  return flags;
}

/**
 * Flag assets still assigned to hires that are offboarding (pending return).
 * `offboardingHireIds` is the set of hires whose assets should come back.
 */
export function flagAssets(
  assets: Asset[],
  offboardingHireIds: ReadonlySet<string>,
): AssetReclaimFlag[] {
  return assets
    .filter(
      (a) =>
        a.status === "assigned" &&
        a.assignedToHireId !== null &&
        offboardingHireIds.has(a.assignedToHireId),
    )
    .map((a) => ({
      kind: "asset" as const,
      assetId: a.id,
      hireId: a.assignedToHireId as string,
      reason: "pending_return" as const,
      detail: "Assigned asset pending return on offboarding",
    }));
}

// ---- helpers --------------------------------------------------------------

function daysSince(iso: string | null, asOf: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  const ms = asOf.getTime() - then;
  if (ms < 0) return 0;
  return ms / (24 * 60 * 60 * 1000);
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

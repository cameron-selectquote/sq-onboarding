import { buildReclaimReport, flagAssets, flagLicenses } from "@/lib/reclaim";
import { OFFBOARDING_COHORT, seedData } from "@/data/seed";
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  License,
} from "@/lib/types";

const apps: AppCatalogItem[] = [
  { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly", seatsOwned: 100, seatsInUseBaseline: 0 },
  { id: "gitlab", name: "GitLab", category: "dev", costPerSeat: 19, billing: "monthly", seatsOwned: 100, seatsInUseBaseline: 0 },
  { id: "slack", name: "Slack", category: "comms", costPerSeat: 8, billing: "monthly", seatsOwned: 100, seatsInUseBaseline: 0 },
];

const asOf = new Date("2026-03-01T00:00:00.000Z");

describe("flagLicenses — idle", () => {
  it("flags an active license unused past the threshold", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const flags = flagLicenses(licenses, apps, { idleDays: 30, asOf });
    expect(flags).toHaveLength(1);
    expect(flags[0]!.reason).toBe("idle");
  });

  it("does not flag a recently used license", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: "2026-02-28T00:00:00.000Z" },
    ];
    expect(flagLicenses(licenses, apps, { idleDays: 30, asOf })).toHaveLength(0);
  });

  it("ignores non-active licenses (revoked, requested)", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "revoked", grantedAt: null, lastUsedAt: "2020-01-01T00:00:00.000Z" },
      { id: "l2", hireId: "h1", appId: "github", status: "requested", grantedAt: null, lastUsedAt: "2020-01-01T00:00:00.000Z" },
    ];
    expect(flagLicenses(licenses, apps, { asOf })).toHaveLength(0);
  });
});

describe("flagLicenses — duplicate", () => {
  it("flags the extra license in the same category for one hire", () => {
    const recent = "2026-02-28T00:00:00.000Z";
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: recent },
      { id: "l2", hireId: "h1", appId: "gitlab", status: "active", grantedAt: null, lastUsedAt: recent },
    ];
    const flags = flagLicenses(licenses, apps, { asOf });
    const dupes = flags.filter((f) => f.reason === "duplicate");
    expect(dupes).toHaveLength(1);
  });

  it("does not flag different categories as duplicates", () => {
    const recent = "2026-02-28T00:00:00.000Z";
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: recent },
      { id: "l2", hireId: "h1", appId: "slack", status: "active", grantedAt: null, lastUsedAt: recent },
    ];
    expect(flagLicenses(licenses, apps, { asOf }).filter((f) => f.reason === "duplicate")).toHaveLength(0);
  });
});

describe("flagLicenses — role_mismatch", () => {
  it("flags an app outside the hire's allowed stack", () => {
    const recent = "2026-02-28T00:00:00.000Z";
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: recent },
    ];
    const flags = flagLicenses(licenses, apps, {
      asOf,
      roleByHireId: { h1: "Designer" },
      allowedAppsByRole: { Designer: new Set(["figma", "slack"]) },
    });
    expect(flags.filter((f) => f.reason === "role_mismatch")).toHaveLength(1);
  });
});

describe("flagAssets", () => {
  it("flags assigned assets for offboarding hires", () => {
    const assets: Asset[] = [
      { id: "a1", catalogId: "mbp", serialTag: "x", status: "assigned", assignedToHireId: "h1", acquiredAt: null, returnedAt: null },
      { id: "a2", catalogId: "mbp", serialTag: "y", status: "assigned", assignedToHireId: "h2", acquiredAt: null, returnedAt: null },
      { id: "a3", catalogId: "mbp", serialTag: "z", status: "in_stock", assignedToHireId: null, acquiredAt: null, returnedAt: null },
    ];
    const flags = flagAssets(assets, new Set(["h1"]));
    expect(flags).toHaveLength(1);
    expect(flags[0]!.assetId).toBe("a1");
    expect(flags[0]!.reason).toBe("pending_return");
  });
});

describe("buildReclaimReport", () => {
  const assetCatalog: AssetCatalogItem[] = [
    { id: "mbp", name: "MacBook Pro", category: "laptop", standardCost: 2800, depreciationMonths: 36 },
  ];

  it("flags idle + duplicate licenses and a pending-return asset, and totals them", () => {
    const stale = "2026-01-01T00:00:00.000Z"; // ~60 days before asOf -> idle
    const recent = "2026-02-28T00:00:00.000Z";
    const licenses: License[] = [
      // idle: GitHub, unused since Jan
      { id: "l_idle", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: stale },
      // duplicate dev-category pair for h2: github + gitlab, both recent
      { id: "l_dup_a", hireId: "h2", appId: "github", status: "active", grantedAt: null, lastUsedAt: recent },
      { id: "l_dup_b", hireId: "h2", appId: "gitlab", status: "active", grantedAt: null, lastUsedAt: recent },
    ];
    const assets: Asset[] = [
      { id: "a1", catalogId: "mbp", serialTag: "x", status: "assigned", assignedToHireId: "h1", acquiredAt: null, returnedAt: null },
    ];

    const report = buildReclaimReport({
      licenses,
      apps,
      assets,
      assetCatalog,
      offboardingHireIds: new Set(["h1"]),
      asOf,
      idleDays: 30,
    });

    // one idle + one duplicate flag
    expect(report.licenseFlags.map((f) => f.reason).sort()).toEqual(["duplicate", "idle"]);
    expect(report.assetFlags).toHaveLength(1);
    expect(report.assetFlags[0]!.reason).toBe("pending_return");

    // recurring: github idle (21/mo) + gitlab duplicate (19/mo) = 40/mo
    expect(report.recurringMonthly).toBe(21 + 19);
    // one-time: MBP residual (acquiredAt null -> full standardCost 2800)
    expect(report.oneTimeAssetResidual).toBe(2800);
  });

  it("counts a license flagged for multiple reasons only once", () => {
    const stale = "2026-01-01T00:00:00.000Z";
    const recent = "2026-02-28T00:00:00.000Z";
    // h1 holds github (idle AND part of a dev duplicate pair) + gitlab (recent)
    const licenses: License[] = [
      { id: "l_both", hireId: "h1", appId: "github", status: "active", grantedAt: null, lastUsedAt: stale },
      { id: "l_other", hireId: "h1", appId: "gitlab", status: "active", grantedAt: null, lastUsedAt: recent },
    ];

    const report = buildReclaimReport({
      licenses,
      apps,
      assets: [],
      assetCatalog,
      offboardingHireIds: new Set(),
      asOf,
      idleDays: 30,
    });

    // github is flagged idle; gitlab is flagged duplicate (second in category).
    // Each license counted once: 21 (github) + 19 (gitlab) = 40/mo. No assets.
    expect(report.recurringMonthly).toBe(21 + 19);
    expect(report.oneTimeAssetResidual).toBe(0);
  });

  it("returns empty lists and a zero total when nothing is reclaimable", () => {
    const report = buildReclaimReport({
      licenses: [],
      apps,
      assets: [],
      assetCatalog,
      offboardingHireIds: new Set(),
      asOf,
    });
    expect(report.licenseFlags).toHaveLength(0);
    expect(report.assetFlags).toHaveLength(0);
    expect(report.recurringMonthly).toBe(0);
    expect(report.oneTimeAssetResidual).toBe(0);
  });
});

describe("buildReclaimReport — shipped seed regression guard", () => {
  // Pins the reclaimable totals the SHIPPED seed data produces, so a future
  // seed edit can't silently drift the finance numbers. Mirrors how
  // getReclaimQueue() (src/server/queries.ts) assembles the report from the
  // seed: offboarding hires -> offboardingHireIds, default idleDays.
  //
  // asOf is FIXED (not the wall clock) so the asset residual — which
  // depreciates against asOf — is deterministic. 2026-06-15 sits before every
  // active license's seeded lastUsedAt (seed.ts backdates those with daysAgo()
  // relative to load time), so no active seat trips the time-dependent idle
  // rule; the recurring total comes entirely from the status-based (idle /
  // reclaim) seats plus the duplicate Zoom seat, which are clock-independent.
  const asOf = new Date("2026-06-15T00:00:00.000Z");

  it("pins the recurring $/mo and one-time asset residual from the seed", () => {
    const offboardingHireIds = new Set(
      seedData.hires
        .filter((h) => h.cohort === OFFBOARDING_COHORT)
        .map((h) => h.id),
    );

    const report = buildReclaimReport({
      licenses: seedData.licenses,
      apps: seedData.appCatalog,
      assets: seedData.assets,
      assetCatalog: seedData.assetCatalog,
      offboardingHireIds,
      asOf,
    });

    // Recurring $/mo — one entry per flagged license, counted once:
    //   lic_5  slack  idle      $8
    //   lic_7  slack  reclaim   $8
    //   lic_12 github idle      $21
    //   lic_13 figma  idle      $15
    //   lic_14 jira   reclaim   $14
    //   lic_15 github idle      $21
    //   lic_16 github idle      $21  (added so reclaim clears the overage)
    //   lic_17 jira   idle      $14  (added so reclaim clears the overage)
    //   lic_3  zoom   duplicate $15  (Zoom annual 180/12; 2nd comms seat for hire_1)
    // = $137/mo. Exact integer dollars -> exact assertion.
    expect(report.recurringMonthly).toBe(8 + 8 + 21 + 15 + 14 + 21 + 21 + 14 + 15);

    // One-time asset residual: the single pending_return laptop asset_mbp_3
    // (mbp16, standardCost 2800, 36-mo straight-line, acquired 2025-06-01),
    // depreciated to asOf. ~$1.8k. Fractional -> tolerance, kept as its own
    // unit (never summed with the $/mo figure).
    expect(report.oneTimeAssetResidual).toBeCloseTo(1831.53, 2);
  });
});

import { flagAssets, flagLicenses } from "@/lib/reclaim";
import type { AppCatalogItem, Asset, License } from "@/lib/types";

const apps: AppCatalogItem[] = [
  { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly" },
  { id: "gitlab", name: "GitLab", category: "dev", costPerSeat: 19, billing: "monthly" },
  { id: "slack", name: "Slack", category: "comms", costPerSeat: 8, billing: "monthly" },
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

  it("ignores non-active licenses", () => {
    const licenses: License[] = [
      { id: "l1", hireId: "h1", appId: "github", status: "revoked", grantedAt: null, lastUsedAt: "2020-01-01T00:00:00.000Z" },
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

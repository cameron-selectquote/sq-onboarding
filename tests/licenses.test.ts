import { createMemoryRepository } from "@/lib/memory-repository";
import { LedgerService } from "@/lib/ledger";
import { LicenseService } from "@/lib/licenses";
import { sequentialIdGenerator } from "@/lib/ids";
import type { AppCatalogItem, Budget, License } from "@/lib/types";

async function setup(opts: { seatsOwned?: number } = {}) {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo, { idGenerator: sequentialIdGenerator("led") });
  const licenses = new LicenseService(repo, ledger, { idGenerator: sequentialIdGenerator("lic") });

  const app: AppCatalogItem = { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly", seatsOwned: opts.seatsOwned ?? 100, seatsInUseBaseline: 0 };
  await repo.appCatalog.insert(app);

  const budget: Budget = { id: "b_it", team: "it", period: "2026-Q1", limit: 1000, spent: 0 };
  await repo.budgets.insert(budget);

  await repo.hires.insert({ id: "h1", name: "Riley Chen", email: "riley@acme.test", roleName: "Software Engineer", managerId: null, startDate: "2026-02-02", cohort: null });

  const license: License = { id: "l1", hireId: "h1", appId: "github", status: "idle", grantedAt: null, lastUsedAt: null };
  await repo.licenses.insert(license);

  return { repo, ledger, licenses };
}

describe("LicenseService.grant", () => {
  it("activates the license, writes a ledger entry, bumps the budget", async () => {
    const { repo, licenses } = await setup();
    const result = await licenses.grant("l1");

    expect(result.status).toBe("active");
    expect(result.grantedAt).not.toBeNull();

    const entries = await repo.ledgerEntries.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("license_grant");
    expect(entries[0]!.amount).toBe(21);
    expect(entries[0]!.refId).toBe("l1");

    expect((await repo.budgets.get("b_it"))!.spent).toBe(21);
  });

  it("throws for an unknown license", async () => {
    const { licenses } = await setup();
    await expect(licenses.grant("nope")).rejects.toThrow(/not found/);
  });
});

describe("LicenseService.revoke", () => {
  it("revokes the license and credits the ledger/budget", async () => {
    const { repo, licenses } = await setup();
    await licenses.grant("l1"); // budget now 21
    const result = await licenses.revoke("l1");

    expect(result.status).toBe("revoked");

    const entries = await repo.ledgerEntries.list();
    const revoke = entries.find((e) => e.type === "license_revoke");
    expect(revoke!.amount).toBe(-21);

    // 21 (grant) - 21 (revoke credit) = 0
    expect((await repo.budgets.get("b_it"))!.spent).toBe(0);
  });
});

describe("LicenseService.assign", () => {
  it("creates a new active license, writes a ledger entry, bumps the budget", async () => {
    const { repo, licenses } = await setup();
    const before = (await repo.licenses.list()).length;

    const result = await licenses.assign("h1", "github");

    expect(result.status).toBe("active");
    expect(result.hireId).toBe("h1");
    expect(result.appId).toBe("github");
    expect(result.grantedAt).not.toBeNull();

    // a brand-new row was created, not the pre-existing idle one
    expect((await repo.licenses.list()).length).toBe(before + 1);
    expect(result.id).not.toBe("l1");

    const entries = await repo.ledgerEntries.list();
    const grant = entries.find((e) => e.type === "license_grant" && e.refId === result.id);
    expect(grant!.amount).toBe(21);
    expect((await repo.budgets.get("b_it"))!.spent).toBe(21);
  });

  it("throws for an unknown hire or app", async () => {
    const { licenses } = await setup();
    await expect(licenses.assign("nope", "github")).rejects.toThrow(/Hire .* not found/);
    await expect(licenses.assign("h1", "nope")).rejects.toThrow(/App .* not found/);
  });

  it("refuses to assign when the owned-seat pool is exhausted", async () => {
    // 1 seat owned, and the pre-seeded idle license already consumes it.
    const { repo, licenses } = await setup({ seatsOwned: 1 });

    await expect(licenses.assign("h1", "github")).rejects.toThrow(/No GitHub seats available/);

    // nothing created, no ledger movement
    expect((await repo.licenses.list()).length).toBe(1);
    expect((await repo.ledgerEntries.list()).length).toBe(0);
    expect((await repo.budgets.get("b_it"))!.spent).toBe(0);
  });
});

describe("LicenseService.grant — capacity", () => {
  it("refuses to grant a requested seat into a now-full pool", async () => {
    // 1 seat owned; the pre-seeded idle license (l1) already consumes it.
    const { repo, licenses } = await setup({ seatsOwned: 1 });

    // A seat requested while there was room, now waiting in the queue.
    await repo.licenses.insert({
      id: "req1", hireId: "h1", appId: "github",
      status: "requested", grantedAt: null, lastUsedAt: null,
    });

    await expect(licenses.grant("req1")).rejects.toThrow(/No GitHub seats available/);

    // license stays requested, no ledger entry, budget untouched
    expect((await repo.licenses.get("req1"))!.status).toBe("requested");
    expect((await repo.ledgerEntries.list()).length).toBe(0);
    expect((await repo.budgets.get("b_it"))!.spent).toBe(0);
  });

  it("grants a requested seat when the pool has room", async () => {
    const { repo, licenses } = await setup({ seatsOwned: 100 });

    await repo.licenses.insert({
      id: "req1", hireId: "h1", appId: "github",
      status: "requested", grantedAt: null, lastUsedAt: null,
    });

    const result = await licenses.grant("req1");
    expect(result.status).toBe("active");

    const entries = await repo.ledgerEntries.list();
    expect(entries.some((e) => e.type === "license_grant" && e.refId === "req1")).toBe(true);
    expect((await repo.budgets.get("b_it"))!.spent).toBe(21);
  });
});

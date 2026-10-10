import { createMemoryRepository } from "@/lib/memory-repository";
import { LedgerService } from "@/lib/ledger";
import { LicenseService } from "@/lib/licenses";
import { sequentialIdGenerator } from "@/lib/ids";
import type { AppCatalogItem, Budget, License } from "@/lib/types";

async function setup() {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo, { idGenerator: sequentialIdGenerator("led") });
  const licenses = new LicenseService(repo, ledger);

  const app: AppCatalogItem = { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly" };
  await repo.appCatalog.insert(app);

  const budget: Budget = { id: "b_it", team: "it", period: "2026-Q1", limit: 1000, spent: 0 };
  await repo.budgets.insert(budget);

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

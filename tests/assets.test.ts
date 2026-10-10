import { createMemoryRepository } from "@/lib/memory-repository";
import { LedgerService } from "@/lib/ledger";
import { AssetService } from "@/lib/assets";
import { sequentialIdGenerator, fixedClock } from "@/lib/ids";
import type { AssetCatalogItem, Budget } from "@/lib/types";

async function setup() {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo, { idGenerator: sequentialIdGenerator("led") });
  const assets = new AssetService(repo, ledger, {
    idGenerator: sequentialIdGenerator("asset"),
    clock: fixedClock("2026-02-01T00:00:00.000Z"),
  });

  const catalog: AssetCatalogItem = { id: "mbp", name: "MBP", category: "laptop", standardCost: 2400, depreciationMonths: 24 };
  await repo.assetCatalog.insert(catalog);

  const budget: Budget = { id: "b_vendor", team: "vendor", period: "2026-Q1", limit: 40000, spent: 0 };
  await repo.budgets.insert(budget);

  return { repo, ledger, assets };
}

describe("AssetService.raisePurchaseOrder", () => {
  it("provisions an assigned asset and writes a one-time ledger entry", async () => {
    const { repo, assets } = await setup();
    const asset = await assets.raisePurchaseOrder({ assetCatalogId: "mbp", hireId: "h1", serialTag: "MBP-1" });

    expect(asset.status).toBe("assigned");
    expect(asset.assignedToHireId).toBe("h1");
    expect(asset.acquiredAt).toBe("2026-02-01T00:00:00.000Z");

    const entries = await repo.ledgerEntries.list();
    expect(entries[0]!.type).toBe("asset_purchase");
    expect(entries[0]!.amount).toBe(2400);
    expect((await repo.budgets.get("b_vendor"))!.spent).toBe(2400);
  });

  it("throws for an unknown catalog item", async () => {
    const { assets } = await setup();
    await expect(
      assets.raisePurchaseOrder({ assetCatalogId: "nope", hireId: "h1", serialTag: "x" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("AssetService.returnAsset", () => {
  it("marks the asset returned and credits residual value", async () => {
    const { repo, assets } = await setup();
    const asset = await assets.raisePurchaseOrder({ assetCatalogId: "mbp", hireId: "h1", serialTag: "MBP-1" });

    const returned = await assets.returnAsset(asset.id);
    expect(returned.status).toBe("returned");
    expect(returned.assignedToHireId).toBeNull();
    expect(returned.returnedAt).toBe("2026-02-01T00:00:00.000Z");

    // Returned same day -> full residual credited back.
    const entries = await repo.ledgerEntries.list();
    const credit = entries.find((e) => e.type === "asset_return");
    expect(credit!.amount).toBe(-2400);
    expect((await repo.budgets.get("b_vendor"))!.spent).toBe(0);
  });
});

import { createMemoryRepository } from "@/lib/memory-repository";
import { LedgerService, sum } from "@/lib/ledger";
import { fixedClock, sequentialIdGenerator } from "@/lib/ids";
import type { Budget } from "@/lib/types";

function makeService() {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo, {
    idGenerator: sequentialIdGenerator("led"),
    clock: fixedClock("2026-02-01T00:00:00.000Z"),
  });
  return { repo, ledger };
}

describe("sum", () => {
  it("adds numbers including negatives", () => {
    expect(sum([10, -4, 2])).toBe(8);
    expect(sum([])).toBe(0);
  });
});

describe("LedgerService.writeEntry", () => {
  it("creates an entry with injected id and clock", async () => {
    const { ledger } = makeService();
    const entry = await ledger.writeEntry({
      hireId: "hire_1",
      type: "fee",
      label: "Setup fee",
      amount: 100,
      costType: "one_time",
    });
    expect(entry.id).toBe("led_1");
    expect(entry.createdAt).toBe("2026-02-01T00:00:00.000Z");
    expect(entry.amount).toBe(100);
  });

  it("rejects a non-finite amount", async () => {
    const { ledger } = makeService();
    await expect(
      ledger.writeEntry({
        hireId: null,
        type: "fee",
        label: "bad",
        amount: Number.NaN,
        costType: "none",
      }),
    ).rejects.toThrow(/finite/);
  });

  it("adjusts the matching budget's spent when budgetTeam is set", async () => {
    const { repo, ledger } = makeService();
    const budget: Budget = {
      id: "b_it",
      team: "it",
      period: "2026-Q1",
      limit: 1000,
      spent: 0,
    };
    await repo.budgets.insert(budget);

    await ledger.writeEntry({
      hireId: "hire_1",
      type: "license_grant",
      label: "Grant",
      amount: 21,
      costType: "recurring",
      budgetTeam: "it",
    });

    expect((await repo.budgets.get("b_it"))!.spent).toBe(21);
  });

  it("credits (reduces) budget spend on a negative amount", async () => {
    const { repo, ledger } = makeService();
    await repo.budgets.insert({
      id: "b_it",
      team: "it",
      period: "2026-Q1",
      limit: 1000,
      spent: 50,
    });
    await ledger.writeEntry({
      hireId: "hire_1",
      type: "license_revoke",
      label: "Revoke",
      amount: -21,
      costType: "recurring",
      budgetTeam: "it",
    });
    expect((await repo.budgets.get("b_it"))!.spent).toBe(29);
  });

  it("does not fail when no matching budget exists", async () => {
    const { ledger } = makeService();
    await expect(
      ledger.writeEntry({
        hireId: "hire_1",
        type: "fee",
        label: "x",
        amount: 5,
        costType: "one_time",
        budgetTeam: "finance",
      }),
    ).resolves.toBeDefined();
  });
});

describe("LedgerService.totalForHire", () => {
  it("sums only the given hire's entries", async () => {
    const { ledger } = makeService();
    await ledger.writeEntry({ hireId: "h1", type: "fee", label: "a", amount: 10, costType: "one_time" });
    await ledger.writeEntry({ hireId: "h1", type: "fee", label: "b", amount: 5, costType: "one_time" });
    await ledger.writeEntry({ hireId: "h2", type: "fee", label: "c", amount: 99, costType: "one_time" });
    expect(await ledger.totalForHire("h1")).toBe(15);
  });
});

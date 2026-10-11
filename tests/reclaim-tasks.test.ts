import { createMemoryRepository } from "@/lib/memory-repository";
import { LedgerService } from "@/lib/ledger";
import { LicenseService } from "@/lib/licenses";
import { ReclaimTaskService } from "@/lib/reclaim-tasks";
import { fixedClock, sequentialIdGenerator } from "@/lib/ids";
import type { AppCatalogItem, Budget, License } from "@/lib/types";

/** Seat cost of the fixture app (monthly billing => $21/mo). */
const MONTHLY = 21;

async function setup() {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo, {
    idGenerator: sequentialIdGenerator("led"),
  });
  const licenses = new LicenseService(repo, ledger);
  const reclaimTasks = new ReclaimTaskService(repo, licenses, {
    idGenerator: sequentialIdGenerator("rt"),
    clock: fixedClock("2026-02-01T00:00:00.000Z"),
  });

  const app: AppCatalogItem = {
    id: "github",
    name: "GitHub",
    category: "dev",
    costPerSeat: MONTHLY,
    billing: "monthly",
  };
  await repo.appCatalog.insert(app);

  const budget: Budget = {
    id: "b_it",
    team: "it",
    period: "2026-Q1",
    limit: 1000,
    spent: 0,
  };
  await repo.budgets.insert(budget);

  const license: License = {
    id: "l1",
    hireId: "h1",
    appId: "github",
    status: "active",
    grantedAt: null,
    lastUsedAt: null,
  };
  await repo.licenses.insert(license);

  return { repo, ledger, licenses, reclaimTasks };
}

describe("ReclaimTaskService.open", () => {
  it("creates a pending job, sets the license to 'reclaim', writes no ledger entry", async () => {
    const { repo, reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");

    expect(task.status).toBe("pending");
    expect(task.createdByTeam).toBe("finance");
    expect(task.completedAt).toBeNull();
    expect(task.cancelledAt).toBeNull();

    expect((await repo.licenses.get("l1"))!.status).toBe("reclaim");
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });

  it("throws for an unknown license", async () => {
    const { reclaimTasks } = await setup();
    await expect(reclaimTasks.open("nope", "finance")).rejects.toThrow(
      /not found/,
    );
  });

  it("one-open-job guard: returns the same task and creates no second job or ledger entry", async () => {
    const { repo, reclaimTasks } = await setup();
    const first = await reclaimTasks.open("l1", "finance");
    const again = await reclaimTasks.open("l1", "it");

    expect(again.id).toBe(first.id);
    expect(again.createdByTeam).toBe("finance"); // unchanged
    expect(await repo.reclaimTasks.list()).toHaveLength(1);
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });
});

describe("ReclaimTaskService.start", () => {
  it("moves pending -> reclaiming with no ledger entry", async () => {
    const { repo, reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    const started = await reclaimTasks.start(task.id);

    expect(started.status).toBe("reclaiming");
    expect((await repo.licenses.get("l1"))!.status).toBe("reclaim");
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });
});

describe("ReclaimTaskService.complete", () => {
  it("is the only ledger write: job -> done, license revoked, exactly one crediting entry", async () => {
    const { repo, reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    await reclaimTasks.start(task.id);
    const done = await reclaimTasks.complete(task.id);

    expect(done.status).toBe("done");
    expect(done.completedAt).toBe("2026-02-01T00:00:00.000Z");
    expect((await repo.licenses.get("l1"))!.status).toBe("revoked");

    const entries = await repo.ledgerEntries.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("license_revoke");
    expect(entries[0]!.amount).toBe(-MONTHLY);
    expect(entries[0]!.costType).toBe("recurring");
  });
});

describe("ReclaimTaskService.cancel", () => {
  it("job -> cancelled, license restored to 'active', no ledger entry", async () => {
    const { repo, reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    const cancelled = await reclaimTasks.cancel(task.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).toBe("2026-02-01T00:00:00.000Z");
    expect((await repo.licenses.get("l1"))!.status).toBe("active");
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });
});

describe("ReclaimTaskService invalid transitions", () => {
  it("start throws on a reclaiming job", async () => {
    const { reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    await reclaimTasks.start(task.id);
    await expect(reclaimTasks.start(task.id)).rejects.toThrow(
      /cannot be started/,
    );
  });

  it("complete throws on a cancelled job", async () => {
    const { reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    await reclaimTasks.cancel(task.id);
    await expect(reclaimTasks.complete(task.id)).rejects.toThrow(
      /cannot be completed/,
    );
  });

  it("cancel throws on a done job", async () => {
    const { reclaimTasks } = await setup();
    const task = await reclaimTasks.open("l1", "finance");
    await reclaimTasks.complete(task.id);
    await expect(reclaimTasks.cancel(task.id)).rejects.toThrow(
      /cannot be cancelled/,
    );
  });

  it("start/complete/cancel throw for an unknown task", async () => {
    const { reclaimTasks } = await setup();
    await expect(reclaimTasks.start("nope")).rejects.toThrow(/not found/);
    await expect(reclaimTasks.complete("nope")).rejects.toThrow(/not found/);
    await expect(reclaimTasks.cancel("nope")).rejects.toThrow(/not found/);
  });
});

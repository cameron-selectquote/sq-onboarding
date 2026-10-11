import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqliteRepository, SqliteRepository } from "@/lib/sqlite-repository";
import { loadSeed, seedData } from "@/data/seed";
import type { Company, Notification, ReclaimTask } from "@/lib/types";

/** Each test gets a fresh in-memory SQLite store for isolation + speed. */
function freshRepo(): SqliteRepository {
  return createSqliteRepository(":memory:");
}

describe("SqliteRepository collection", () => {
  const company: Company = { id: "c1", name: "Acme", size: 10, industry: "x" };
  let repo: SqliteRepository;

  afterEach(() => {
    repo?.close();
  });

  it("inserts and reads back a record", async () => {
    repo = freshRepo();
    await repo.companies.insert(company);
    expect(await repo.companies.get("c1")).toEqual(company);
  });

  it("rejects duplicate ids", async () => {
    repo = freshRepo();
    await repo.companies.insert(company);
    await expect(repo.companies.insert(company)).rejects.toThrow(/already exists/);
  });

  it("returns null for a missing record", async () => {
    repo = freshRepo();
    expect(await repo.companies.get("nope")).toBeNull();
  });

  it("updates a record without changing its id", async () => {
    repo = freshRepo();
    await repo.companies.insert(company);
    const updated = await repo.companies.update("c1", {
      name: "Acme 2",
      id: "hacked", // id changes must be ignored by update()
    } as Partial<Company>);
    expect(updated.id).toBe("c1");
    expect(updated.name).toBe("Acme 2");
    expect((await repo.companies.get("c1"))!.name).toBe("Acme 2");
  });

  it("throws when updating a missing record", async () => {
    repo = freshRepo();
    await expect(repo.companies.update("nope", { name: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("removes a record", async () => {
    repo = freshRepo();
    await repo.companies.insert(company);
    await repo.companies.remove("c1");
    expect(await repo.companies.get("c1")).toBeNull();
  });

  it("filters with where()", async () => {
    repo = freshRepo();
    await repo.companies.insert(company);
    await repo.companies.insert({ ...company, id: "c2", size: 99 });
    const big = await repo.companies.where((c) => c.size > 50);
    expect(big.map((c) => c.id)).toEqual(["c2"]);
  });

  it("round-trips nulls and numbers", async () => {
    repo = freshRepo();
    await repo.users.insert({
      id: "u1",
      name: "Nym",
      email: "n@x.test",
      role: "manager",
      team: null,
      managerId: null,
    });
    const got = await repo.users.get("u1");
    expect(got).toEqual({
      id: "u1",
      name: "Nym",
      email: "n@x.test",
      role: "manager",
      team: null,
      managerId: null,
    });
  });

  it("round-trips the boolean notification.read field", async () => {
    repo = freshRepo();
    const n: Notification = {
      id: "n1",
      targetTeam: "it",
      message: "hi",
      batchId: null,
      read: false,
    };
    await repo.notifications.insert(n);
    expect(await repo.notifications.get("n1")).toEqual(n);

    const updated = await repo.notifications.update("n1", { read: true });
    expect(updated.read).toBe(true);
    expect((await repo.notifications.get("n1"))!.read).toBe(true);
  });

  it("round-trips a ReclaimTask (null timestamps), updates and filters it", async () => {
    repo = freshRepo();
    const task: ReclaimTask = {
      id: "rt1",
      licenseId: "lic_7",
      status: "pending",
      createdByTeam: "finance",
      createdAt: "2026-02-01T00:00:00.000Z",
      completedAt: null,
      cancelledAt: null,
    };
    await repo.reclaimTasks.insert(task);
    expect(await repo.reclaimTasks.get("rt1")).toEqual(task);

    const updated = await repo.reclaimTasks.update("rt1", {
      status: "reclaiming",
    });
    expect(updated.status).toBe("reclaiming");

    const open = await repo.reclaimTasks.where((t) => t.licenseId === "lic_7");
    expect(open.map((t) => t.id)).toEqual(["rt1"]);
  });

  it("loads the full seed dataset", async () => {
    repo = freshRepo();
    expect(repo.isEmpty()).toBe(true);
    await loadSeed(repo);
    expect(repo.isEmpty()).toBe(false);

    expect((await repo.companies.list()).length).toBe(seedData.companies.length);
    expect((await repo.hires.list()).length).toBe(seedData.hires.length);
    expect((await repo.licenses.list()).length).toBe(seedData.licenses.length);
    expect((await repo.appCatalog.list()).length).toBe(seedData.appCatalog.length);
  });
});

describe("SqliteRepository.backup", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-backup-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports :memory: stores as in-memory", () => {
    const repo = createSqliteRepository(":memory:");
    expect(repo.inMemory).toBe(true);
    repo.close();
  });

  it("snapshots current data, unaffected by a later reset", async () => {
    const live = createSqliteRepository(path.join(dir, "live.sqlite"));
    expect(live.inMemory).toBe(false);
    await loadSeed(live);
    const hires = (await live.hires.list()).length;
    expect(hires).toBeGreaterThan(0);

    const dest = path.join(dir, "live.sqlite-backup-test");
    await live.backup(dest);
    await live.reset();
    expect(await live.hires.list()).toHaveLength(0);
    live.close();

    const restored = createSqliteRepository(dest);
    expect(await restored.hires.list()).toHaveLength(hires);
    restored.close();
  });
});

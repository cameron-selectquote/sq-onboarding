import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createSqliteRepository, SqliteRepository } from "@/lib/sqlite-repository";
import { backfillSeedFields, seedData } from "@/data/seed";

/**
 * A DB file as written by the release before inventory management: same tables,
 * but app_catalog lacks seatsOwned/seatsInUseBaseline and task/template_task lack appId.
 */
function writeLegacyDb(file: string): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE "app_catalog" ("id" TEXT PRIMARY KEY, "name" TEXT, "category" TEXT, "costPerSeat" NUMERIC, "billing" TEXT);
    CREATE TABLE "task" ("id" TEXT PRIMARY KEY, "hireId" TEXT, "title" TEXT, "ownerTeam" TEXT, "status" TEXT, "cost" NUMERIC, "costType" TEXT);
  `);
  const github = seedData.appCatalog.find((a) => a.id === "github")!;
  db.prepare(`INSERT INTO "app_catalog" VALUES (?, ?, ?, ?, ?)`).run(
    github.id, github.name, github.category, github.costPerSeat, github.billing,
  );
  // An app added at runtime (not in the seed) must be left alone.
  db.prepare(`INSERT INTO "app_catalog" VALUES ('custom', 'Custom', 'dev', 5, 'monthly')`).run();
  db.close();
}

describe("SqliteRepository additive migration", () => {
  let dir: string;
  let file: string;
  let repo: SqliteRepository | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "provision-migrate-"));
    file = path.join(dir, "provision.sqlite");
    writeLegacyDb(file);
  });

  afterEach(() => {
    repo?.close();
    repo = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("adds columns the schema defines but an older file lacks", async () => {
    repo = createSqliteRepository(file);
    expect(repo.addedColumns).toEqual(
      expect.arrayContaining([
        { collection: "appCatalog", table: "app_catalog", column: "seatsOwned" },
        { collection: "appCatalog", table: "app_catalog", column: "seatsInUseBaseline" },
        { collection: "tasks", table: "task", column: "appId" },
      ]),
    );
    // The query that crashed prod ("no such column: seatsOwned") now works.
    await expect(repo.appCatalog.list()).resolves.toHaveLength(2);
  });

  it("is a no-op on a file that is already current", () => {
    createSqliteRepository(file).close();
    repo = createSqliteRepository(file);
    expect(repo.addedColumns).toEqual([]);
  });

  it("backfills new columns from the seed for seed rows only", async () => {
    repo = createSqliteRepository(file);
    const patched = await backfillSeedFields(repo, repo.addedColumns);
    expect(patched).toBe(1);

    const seedGithub = seedData.appCatalog.find((a) => a.id === "github")!;
    const github = await repo.appCatalog.get("github");
    expect(github?.seatsOwned).toBe(seedGithub.seatsOwned);
    expect(github?.seatsInUseBaseline).toBe(seedGithub.seatsInUseBaseline);

    const custom = await repo.appCatalog.get("custom");
    expect(custom?.seatsOwned).toBeNull();
  });

  it("never overwrites a value that is already set", async () => {
    repo = createSqliteRepository(file);
    await repo.appCatalog.update("github", { seatsOwned: 7 });
    await backfillSeedFields(repo, repo.addedColumns);
    expect((await repo.appCatalog.get("github"))?.seatsOwned).toBe(7);
  });
});

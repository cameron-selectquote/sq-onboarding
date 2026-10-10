import { createMemoryRepository } from "@/lib/memory-repository";
import { loadSeed, seedData } from "@/data/seed";

describe("seed data", () => {
  it("loads into a repository without id collisions", async () => {
    const repo = createMemoryRepository();
    await expect(loadSeed(repo)).resolves.toBeUndefined();

    expect(await repo.hires.list()).toHaveLength(seedData.hires.length);
    expect(await repo.appCatalog.list()).toHaveLength(seedData.appCatalog.length);
    expect(await repo.budgets.list()).toHaveLength(seedData.budgets.length);
  });

  it("every template task points at a real template", async () => {
    const templateIds = new Set(seedData.templates.map((t) => t.id));
    for (const tt of seedData.templateTasks) {
      expect(templateIds.has(tt.templateId)).toBe(true);
    }
  });

  it("every seed asset points at a real catalog item", async () => {
    const catalogIds = new Set(seedData.assetCatalog.map((c) => c.id));
    for (const a of seedData.assets) {
      expect(catalogIds.has(a.catalogId)).toBe(true);
    }
  });
});

import { createMemoryRepository } from "@/lib/memory-repository";
import { loadSeed, OFFBOARDING_COHORT, seedData } from "@/data/seed";
import { buildReclaimReport } from "@/lib/reclaim";

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

  it("starts with reclaimable spend so the banner starts red", async () => {
    const repo = createMemoryRepository();
    await loadSeed(repo);

    const [licenses, apps, assets, assetCatalog, hires] = await Promise.all([
      repo.licenses.list(),
      repo.appCatalog.list(),
      repo.assets.list(),
      repo.assetCatalog.list(),
      repo.hires.list(),
    ]);
    const offboardingHireIds = new Set(
      hires.filter((h) => h.cohort === OFFBOARDING_COHORT).map((h) => h.id),
    );

    const report = buildReclaimReport({
      licenses,
      apps,
      assets,
      assetCatalog,
      offboardingHireIds,
    });

    expect(report.reclaimableTotal).toBeGreaterThan(0);
    expect(report.licenseFlags.length).toBeGreaterThan(0);
    expect(report.assetFlags.length).toBeGreaterThan(0);
  });
});

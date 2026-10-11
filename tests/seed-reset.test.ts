import {MemoryRepository, createMemoryRepository} from '@/lib/memory-repository';
import {loadSeed, seedData} from '@/data/seed';
import type {Repository} from '@/lib/repository';

/** Total seeded row count across the collections the seed populates. */
async function totalRows(repo: Repository): Promise<number> {
  const lists = await Promise.all([
    repo.companies.list(),
    repo.users.list(),
    repo.appCatalog.list(),
    repo.assetCatalog.list(),
    repo.assets.list(),
    repo.templates.list(),
    repo.templateTasks.list(),
    repo.hires.list(),
    repo.tasks.list(),
    repo.licenses.list(),
    repo.budgets.list(),
    repo.candidates.list(),
  ]);
  return lists.reduce((sum, rows) => sum + rows.length, 0);
}

describe('Collection.clear', () => {
  it('empties a populated collection', async () => {
    const repo = createMemoryRepository();
    await repo.hires.insert({
      id: 'h1',
      name: 'A',
      email: 'a@test',
      roleName: 'Software Engineer',
      managerId: null,
      startDate: '2026-01-01',
      cohort: null,
    });
    expect(await repo.hires.list()).toHaveLength(1);

    await repo.hires.clear();
    expect(await repo.hires.list()).toHaveLength(0);
  });

  it('is a no-op on an empty collection', async () => {
    const repo = createMemoryRepository();
    await repo.hires.clear();
    expect(await repo.hires.list()).toHaveLength(0);
  });
});

describe('Repository.reset', () => {
  it('empties every collection', async () => {
    const repo = new MemoryRepository();
    await loadSeed(repo);
    expect(await totalRows(repo)).toBeGreaterThan(0);

    await repo.reset();
    expect(await totalRows(repo)).toBe(0);
    // Spot-check a few collections individually.
    expect(await repo.hires.list()).toHaveLength(0);
    expect(await repo.licenses.list()).toHaveLength(0);
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });
});

describe('reset + reseed round-trip', () => {
  it('restores the same row counts as a fresh seed', async () => {
    const repo = new MemoryRepository();
    await loadSeed(repo);
    const before = await totalRows(repo);

    await repo.reset();
    await loadSeed(repo);

    expect(await totalRows(repo)).toBe(before);
    expect(await repo.hires.list()).toHaveLength(seedData.hires.length);
    expect(await repo.licenses.list()).toHaveLength(seedData.licenses.length);
  });

  it('discards dirtied state so the baseline is restored', async () => {
    const repo = new MemoryRepository();
    await loadSeed(repo);

    // Dirty the store the way a demo run would: revoke a seat, add a hire.
    await repo.licenses.update('lic_1', {status: 'revoked', grantedAt: null});
    await repo.hires.insert({
      id: 'hire_stray',
      name: 'Stray',
      email: 'stray@test',
      roleName: 'Software Engineer',
      managerId: null,
      startDate: '2026-01-01',
      cohort: null,
    });

    await repo.reset();
    await loadSeed(repo);

    // The stray hire is gone and the revoked seat is back to its seeded state.
    expect(await repo.hires.get('hire_stray')).toBeNull();
    const lic1 = await repo.licenses.get('lic_1');
    const seededLic1 = seedData.licenses.find((l) => l.id === 'lic_1');
    expect(lic1).toEqual(seededLic1);
  });
});

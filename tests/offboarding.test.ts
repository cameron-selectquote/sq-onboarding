import {createMemoryRepository} from '@/lib/memory-repository';
import {LedgerService} from '@/lib/ledger';
import {LicenseService} from '@/lib/licenses';
import {AssetService} from '@/lib/assets';
import {OffboardingService} from '@/lib/offboarding';
import {NotificationService} from '@/lib/notifications';
import {OFFBOARDING_COHORT} from '@/lib/cohorts';
import {sequentialIdGenerator, fixedClock} from '@/lib/ids';
import type {Repository} from '@/lib/repository';

async function seedOffboardable(): Promise<Repository> {
  const repo = createMemoryRepository();
  await repo.appCatalog.insert({
    id: 'github',
    name: 'GitHub',
    category: 'dev',
    costPerSeat: 21,
    billing: 'monthly',
  });
  await repo.appCatalog.insert({
    id: 'slack',
    name: 'Slack',
    category: 'comms',
    costPerSeat: 8,
    billing: 'monthly',
  });
  await repo.assetCatalog.insert({
    id: 'mbp16',
    name: 'MacBook Pro 16"',
    category: 'laptop',
    standardCost: 2800,
    depreciationMonths: 36,
  });
  await repo.budgets.insert({
    id: 'bud_it',
    team: 'it',
    period: '2026-Q1',
    limit: 5000,
    spent: 500,
  });
  await repo.budgets.insert({
    id: 'bud_vendor',
    team: 'vendor',
    period: '2026-Q1',
    limit: 40000,
    spent: 3000,
  });

  await repo.hires.insert({
    id: 'hire_z',
    name: 'Quinn Baker',
    email: 'q@acme.test',
    roleName: 'Software Engineer',
    managerId: 'u_mgr',
    startDate: '2025-06-01',
    cohort: null,
  });

  await repo.licenses.insert({
    id: 'lic_a',
    hireId: 'hire_z',
    appId: 'github',
    status: 'active',
    grantedAt: '2025-06-01T00:00:00.000Z',
    lastUsedAt: '2025-06-10T00:00:00.000Z',
  });
  await repo.licenses.insert({
    id: 'lic_b',
    hireId: 'hire_z',
    appId: 'slack',
    status: 'idle',
    grantedAt: '2025-06-01T00:00:00.000Z',
    lastUsedAt: '2025-07-01T00:00:00.000Z',
  });
  // A revoked seat should be ignored (nothing to recover).
  await repo.licenses.insert({
    id: 'lic_c',
    hireId: 'hire_z',
    appId: 'github',
    status: 'revoked',
    grantedAt: null,
    lastUsedAt: null,
  });

  await repo.assets.insert({
    id: 'asset_z',
    catalogId: 'mbp16',
    serialTag: 'MBP-Z',
    status: 'assigned',
    assignedToHireId: 'hire_z',
    acquiredAt: '2025-06-01',
    returnedAt: null,
  });
  return repo;
}

function service(repo: Repository): OffboardingService {
  const ledger = new LedgerService(repo, {
    idGenerator: sequentialIdGenerator('led'),
    clock: fixedClock('2026-03-01T00:00:00.000Z'),
  });
  const licenses = new LicenseService(repo, ledger);
  const assets = new AssetService(repo, ledger, {
    idGenerator: sequentialIdGenerator('as'),
    clock: fixedClock('2026-03-01T00:00:00.000Z'),
  });
  return new OffboardingService(repo, licenses, assets);
}

describe('OffboardingService.preview', () => {
  it('lists active/idle seats + assigned assets with recoverable value, and changes nothing', async () => {
    const repo = await seedOffboardable();
    const svc = service(repo);
    const p = await svc.preview('hire_z');

    expect(p.seats.map((s) => s.appId).sort()).toEqual(['github', 'slack']); // revoked one excluded
    expect(p.monthlyRecovered).toBe(29); // 21 + 8
    expect(p.assets.map((a) => a.assetId)).toEqual(['asset_z']);
    expect(p.oneTimeRecovered).toBeGreaterThan(0);
    expect(p.nothingToReclaim).toBe(false);

    // Read-only: statuses untouched, no ledger entries written.
    const licenses = await repo.licenses.where((l) => l.hireId === 'hire_z');
    expect(licenses.find((l) => l.id === 'lic_a')?.status).toBe('active');
    expect(await repo.ledgerEntries.list()).toHaveLength(0);
  });

  it('reports nothing to reclaim for a hire with no active seats or assets', async () => {
    const repo = createMemoryRepository();
    await repo.hires.insert({
      id: 'h0',
      name: 'Nobody',
      email: 'n@a.test',
      roleName: 'Operations',
      managerId: null,
      startDate: '2026-01-01',
      cohort: null,
    });
    const p = await service(repo).preview('h0');
    expect(p.nothingToReclaim).toBe(true);
    expect(p.monthlyRecovered).toBe(0);
  });
});

describe('OffboardingService.execute', () => {
  it('revokes seats, returns assets, and credits the ledger', async () => {
    const repo = await seedOffboardable();
    const svc = service(repo);
    const r = await svc.execute('hire_z');

    expect(r.revokedSeatIds.sort()).toEqual(['lic_a', 'lic_b']);
    expect(r.returnedAssetIds).toEqual(['asset_z']);

    const licenses = await repo.licenses.where((l) => l.hireId === 'hire_z');
    expect(licenses.find((l) => l.id === 'lic_a')?.status).toBe('revoked');
    expect(licenses.find((l) => l.id === 'lic_b')?.status).toBe('revoked');

    const asset = await repo.assets.get('asset_z');
    expect(asset?.status).toBe('returned');
    expect(asset?.assignedToHireId).toBeNull();

    // Ledger has crediting (negative) entries for the recovery.
    const entries = await repo.ledgerEntries.list();
    const credits = entries.filter((e) => e.amount < 0);
    expect(credits.length).toBe(3); // 2 revokes + 1 return
    expect(entries.some((e) => e.type === 'license_revoke')).toBe(true);
    expect(entries.some((e) => e.type === 'asset_return')).toBe(true);
  });

  it("is a no-op when there's nothing to reclaim", async () => {
    const repo = createMemoryRepository();
    await repo.hires.insert({
      id: 'h0',
      name: 'Nobody',
      email: 'n@a.test',
      roleName: 'Operations',
      managerId: null,
      startDate: '2026-01-01',
      cohort: null,
    });
    const r = await service(repo).execute('h0');
    expect(r.revokedSeatIds).toHaveLength(0);
    expect(r.returnedAssetIds).toHaveLength(0);
  });

  it('flips the hire into the offboarding cohort so active views drop them', async () => {
    const repo = await seedOffboardable();
    await service(repo).execute('hire_z');
    const hire = await repo.hires.get('hire_z');
    expect(hire?.cohort).toBe(OFFBOARDING_COHORT);
  });

  it('notifies IT and vendor under one batch when a notifier is injected', async () => {
    const repo = await seedOffboardable();
    const notifications = new NotificationService(repo, {
      idGenerator: sequentialIdGenerator('ntf'),
    });
    const ledger = new LedgerService(repo, {
      idGenerator: sequentialIdGenerator('led'),
      clock: fixedClock('2026-03-01T00:00:00.000Z'),
    });
    const licenses = new LicenseService(repo, ledger);
    const assets = new AssetService(repo, ledger, {
      idGenerator: sequentialIdGenerator('as'),
      clock: fixedClock('2026-03-01T00:00:00.000Z'),
    });
    const svc = new OffboardingService(repo, licenses, assets, {
      notifications,
    });

    await svc.execute('hire_z');

    const it = await notifications.forTeam('it');
    const vendor = await notifications.forTeam('vendor');
    expect(it).toHaveLength(1);
    expect(it[0]?.message).toMatch(/offboarded/i);
    expect(vendor).toHaveLength(1);
    expect(vendor[0]?.message).toMatch(/collect/i);
    expect(it[0]?.batchId).toBe('offboard_hire_z');
    expect(vendor[0]?.batchId).toBe('offboard_hire_z');
  });
});

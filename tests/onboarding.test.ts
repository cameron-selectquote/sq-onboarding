import {createMemoryRepository} from '@/lib/memory-repository';
import {LedgerService} from '@/lib/ledger';
import {LicenseService} from '@/lib/licenses';
import {AssetService} from '@/lib/assets';
import {OnboardingExecutor} from '@/lib/onboarding';
import {NotificationService} from '@/lib/notifications';
import {sequentialIdGenerator, fixedClock} from '@/lib/ids';
import type {Repository} from '@/lib/repository';

async function seedHireWithSweTasks(): Promise<Repository> {
  const repo = createMemoryRepository();
  // Catalog the executor references.
  await repo.appCatalog.insert({
    id: 'github',
    name: 'GitHub',
    category: 'dev',
    costPerSeat: 21,
    billing: 'monthly',
    seatsOwned: 100,
    seatsInUseBaseline: 0,
  });
  await repo.appCatalog.insert({
    id: 'slack',
    name: 'Slack',
    category: 'comms',
    costPerSeat: 8,
    billing: 'monthly',
    seatsOwned: 100,
    seatsInUseBaseline: 0,
  });
  await repo.assetCatalog.insert({
    id: 'mbp16',
    name: 'MacBook Pro 16"',
    category: 'laptop',
    standardCost: 2800,
    depreciationMonths: 36,
  });
  await repo.assetCatalog.insert({
    id: 'badge',
    name: 'Access Badge',
    category: 'facilities',
    standardCost: 25,
    depreciationMonths: 12,
  });
  await repo.budgets.insert({
    id: 'bud_it',
    team: 'it',
    period: '2026-Q1',
    limit: 5000,
    spent: 0,
  });
  await repo.budgets.insert({
    id: 'bud_vendor',
    team: 'vendor',
    period: '2026-Q1',
    limit: 40000,
    spent: 0,
  });

  await repo.hires.insert({
    id: 'hire_x',
    name: 'Nora Alvarez',
    email: 'n@acme.test',
    roleName: 'Software Engineer',
    managerId: 'u_mgr',
    startDate: '2026-03-02',
    cohort: null,
  });

  // The five SWE template tasks, all todo.
  const tasks = [
    {
      id: 't1',
      title: 'Create email + SSO',
      ownerTeam: 'it' as const,
      cost: 0,
      costType: 'none' as const,
    },
    {
      id: 't2',
      title: 'Order laptop',
      ownerTeam: 'vendor' as const,
      cost: 2800,
      costType: 'one_time' as const,
    },
    {
      id: 't3',
      title: 'Grant GitHub seat',
      ownerTeam: 'it' as const,
      cost: 21,
      costType: 'recurring' as const,
    },
    {
      id: 't4',
      title: 'Grant Slack seat',
      ownerTeam: 'it' as const,
      cost: 8,
      costType: 'recurring' as const,
    },
    {
      id: 't5',
      title: 'Issue access badge',
      ownerTeam: 'facilities' as const,
      cost: 25,
      costType: 'one_time' as const,
    },
    {
      id: 't6',
      title: 'Week 1: meet the team',
      ownerTeam: 'hr' as const,
      cost: 0,
      costType: 'none' as const,
    },
  ];
  for (const t of tasks)
    await repo.tasks.insert({hireId: 'hire_x', status: 'todo', appId: null, ...t});
  return repo;
}

function executor(repo: Repository): OnboardingExecutor {
  const ledger = new LedgerService(repo, {
    idGenerator: sequentialIdGenerator('led'),
    clock: fixedClock('2026-03-01T00:00:00.000Z'),
  });
  const licenses = new LicenseService(repo, ledger);
  const assets = new AssetService(repo, ledger, {
    idGenerator: sequentialIdGenerator('asset'),
    clock: fixedClock('2026-03-01T00:00:00.000Z'),
  });
  return new OnboardingExecutor(repo, licenses, assets, {
    serialGenerator: sequentialIdGenerator('sn'),
  });
}

describe('OnboardingExecutor.executeForHire', () => {
  it('automates seats, laptop, badge, and email/SSO; skips human tasks', async () => {
    const repo = await seedHireWithSweTasks();
    const report = await executor(repo).executeForHire('hire_x');

    expect(report.automated).toBe(5);
    expect(report.skipped).toBe(1);

    const byTitle = Object.fromEntries(
      report.executions.map((e) => [e.title, e.outcome]),
    );
    expect(byTitle['Create email + SSO']).toBe('completed');
    expect(byTitle['Order laptop']).toBe('ordered');
    expect(byTitle['Grant GitHub seat']).toBe('granted');
    expect(byTitle['Grant Slack seat']).toBe('granted');
    expect(byTitle['Issue access badge']).toBe('ordered');
    expect(byTitle['Week 1: meet the team']).toBe('skipped');
  });

  it('marks automated tasks done and leaves human tasks todo', async () => {
    const repo = await seedHireWithSweTasks();
    await executor(repo).executeForHire('hire_x');
    const tasks = await repo.tasks.where((t) => t.hireId === 'hire_x');
    const status = Object.fromEntries(tasks.map((t) => [t.title, t.status]));
    expect(status['Grant GitHub seat']).toBe('done');
    expect(status['Order laptop']).toBe('done');
    expect(status['Week 1: meet the team']).toBe('todo');
  });

  it('creates and grants licenses (active) and provisions assets with ledger spend', async () => {
    const repo = await seedHireWithSweTasks();
    await executor(repo).executeForHire('hire_x');

    const licenses = await repo.licenses.where((l) => l.hireId === 'hire_x');
    expect(licenses.map((l) => l.appId).sort()).toEqual(['github', 'slack']);
    expect(licenses.every((l) => l.status === 'active')).toBe(true);

    const assets = await repo.assets.where(
      (a) => a.assignedToHireId === 'hire_x',
    );
    expect(assets.map((a) => a.catalogId).sort()).toEqual(['badge', 'mbp16']);

    // Spend hit the ledger: 2 grants + laptop + badge.
    const entries = await repo.ledgerEntries.list();
    const types = entries.map((e) => e.type).sort();
    expect(types).toEqual([
      'asset_purchase',
      'asset_purchase',
      'license_grant',
      'license_grant',
    ]);
  });

  it('is idempotent on a second run (nothing left to do)', async () => {
    const repo = await seedHireWithSweTasks();
    const exec = executor(repo);
    await exec.executeForHire('hire_x');
    const second = await exec.executeForHire('hire_x');
    // Only the human task remains, still skipped; no new automation.
    expect(second.automated).toBe(0);
    expect(second.executions.every((e) => e.outcome === 'skipped')).toBe(true);
  });

  it('honors skipKeywords: a skipped seat is not granted', async () => {
    const repo = await seedHireWithSweTasks();
    const report = await executor(repo).executeForHire('hire_x', {
      skipKeywords: ['slack'],
    });

    const slack = report.executions.find((e) => /slack/i.test(e.title));
    expect(slack?.outcome).toBe('skipped');
    expect(slack?.detail).toMatch(/skipped/i);

    const licenses = await repo.licenses.where((l) => l.hireId === 'hire_x');
    expect(licenses.map((l) => l.appId)).not.toContain('slack');
    expect(licenses.map((l) => l.appId)).toContain('github');

    // The skipped-seat task stays todo, not done.
    const tasks = await repo.tasks.where((t) => t.hireId === 'hire_x');
    const slackTask = tasks.find((t) => /slack/i.test(t.title));
    expect(slackTask?.status).toBe('todo');
  });

  it('notifies each owning team once per run when a notifier is injected', async () => {
    const repo = await seedHireWithSweTasks();
    const notifications = new NotificationService(repo, {
      idGenerator: sequentialIdGenerator('ntf'),
    });
    const ledger = new LedgerService(repo, {
      idGenerator: sequentialIdGenerator('led'),
      clock: fixedClock('2026-03-01T00:00:00.000Z'),
    });
    const licenses = new LicenseService(repo, ledger);
    const assets = new AssetService(repo, ledger, {
      idGenerator: sequentialIdGenerator('asset'),
      clock: fixedClock('2026-03-01T00:00:00.000Z'),
    });
    const exec = new OnboardingExecutor(repo, licenses, assets, {
      serialGenerator: sequentialIdGenerator('sn'),
      notifications,
    });

    await exec.executeForHire('hire_x');

    // IT (email/SSO + 2 grants), vendor (laptop), facilities (badge) each get
    // one batched message; HR's task was human-only (skipped) so no inbox item.
    expect(await notifications.unreadCount('it')).toBe(1);
    expect(await notifications.unreadCount('vendor')).toBe(1);
    expect(await notifications.unreadCount('facilities')).toBe(1);
    expect(await notifications.unreadCount('hr')).toBe(0);

    const it = await notifications.forTeam('it');
    expect(it[0]?.message).toMatch(/Nora Alvarez/);
    expect(it[0]?.batchId).toBe('onboard_hire_x');
  });
});

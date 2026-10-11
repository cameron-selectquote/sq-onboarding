import {createMemoryRepository} from '@/lib/memory-repository';
import {TemplateService} from '@/lib/templates';
import {sequentialIdGenerator, fixedClock} from '@/lib/ids';
import type {AppCatalogItem, Hire, Template, TemplateTask} from '@/lib/types';

async function setup() {
  const repo = createMemoryRepository();
  const templates = new TemplateService(repo, {
    idGenerator: sequentialIdGenerator('x'),
    clock: fixedClock('2026-02-01T00:00:00.000Z'),
  });

  const template: Template = {id: 'tpl_swe', roleName: 'Software Engineer'};
  await repo.templates.insert(template);

  const tasks: TemplateTask[] = [
    {
      id: 'tt1',
      templateId: 'tpl_swe',
      title: 'Create email',
      ownerTeam: 'it',
      cost: 0,
      costType: 'none',
      appId: null,
    },
    {
      id: 'tt2',
      templateId: 'tpl_swe',
      title: 'Order laptop',
      ownerTeam: 'vendor',
      cost: 2800,
      costType: 'one_time',
      appId: null,
    },
  ];
  for (const t of tasks) await repo.templateTasks.insert(t);

  const hire: Hire = {
    id: 'h1',
    name: 'Riley',
    email: 'r@x.test',
    roleName: 'Software Engineer',
    managerId: null,
    startDate: '2026-02-02',
    cohort: null,
  };
  await repo.hires.insert(hire);

  return {repo, templates};
}

describe('TemplateService.instantiateForHire', () => {
  it('creates a task per template task, all status todo', async () => {
    const {repo, templates} = await setup();
    const result = await templates.instantiateForHire('h1', 'tpl_swe');

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((t) => t.status === 'todo')).toBe(true);
    expect(result.tasks.every((t) => t.hireId === 'h1')).toBe(true);

    const stored = await repo.tasks.where((t) => t.hireId === 'h1');
    expect(stored).toHaveLength(2);
  });

  it('grants an active license per supplied appId', async () => {
    const {templates} = await setup();
    const result = await templates.instantiateForHire('h1', 'tpl_swe', [
      'github',
      'slack',
    ]);
    expect(result.licenses).toHaveLength(2);
    expect(result.licenses.every((l) => l.status === 'active')).toBe(true);
    expect(result.licenses[0]!.grantedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('throws for an unknown hire or template', async () => {
    const {templates} = await setup();
    await expect(
      templates.instantiateForHire('nope', 'tpl_swe'),
    ).rejects.toThrow(/Hire/);
    await expect(templates.instantiateForHire('h1', 'nope')).rejects.toThrow(
      /Template/,
    );
  });

  it('defers a seat to the queue when the app pool is full', async () => {
    const {repo, templates} = await setup();

    // GitHub pool: 1 seat owned, already fully consumed by the baseline.
    const github: AppCatalogItem = {
      id: 'github',
      name: 'GitHub',
      category: 'dev',
      costPerSeat: 21,
      billing: 'monthly',
      seatsOwned: 1,
      seatsInUseBaseline: 1,
    };
    await repo.appCatalog.insert(github);

    const result = await templates.instantiateForHire('h1', 'tpl_swe', [
      'github',
    ]);

    // Not granted: no active license returned, instead deferred.
    expect(result.licenses).toHaveLength(0);
    expect(result.deferred).toEqual([{appId: 'github', appName: 'GitHub'}]);

    // A requested license exists (asked-for-but-not-granted) for IT's queue.
    const stored = await repo.licenses.where(
      (l) => l.hireId === 'h1' && l.appId === 'github',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.status).toBe('requested');
    expect(stored[0]!.grantedAt).toBeNull();
  });

  it('grants what fits and defers the overflow within one batch', async () => {
    const {repo, templates} = await setup();

    // 1 Figma seat owned, none used yet → first grant fits, second defers.
    const figma: AppCatalogItem = {
      id: 'figma',
      name: 'Figma',
      category: 'design',
      costPerSeat: 15,
      billing: 'monthly',
      seatsOwned: 1,
      seatsInUseBaseline: 0,
    };
    await repo.appCatalog.insert(figma);

    const result = await templates.instantiateForHire('h1', 'tpl_swe', [
      'figma',
      'figma',
    ]);

    expect(result.licenses).toHaveLength(1); // first fits
    expect(result.deferred).toEqual([{appId: 'figma', appName: 'Figma'}]); // second deferred
  });
});

describe('TemplateService.createTemplate', () => {
  it('persists a new template with task + seat template-tasks', async () => {
    const {repo, templates} = await setup();
    await repo.appCatalog.insert({
      id: 'notion',
      name: 'Notion',
      category: 'docs',
      costPerSeat: 10,
      billing: 'monthly',
      seatsOwned: 100,
      seatsInUseBaseline: 0,
    });

    const result = await templates.createTemplate({
      roleName: 'Data Analyst',
      taskTitles: ['Create email + SSO', 'Order laptop'],
      seatAppIds: ['notion'],
    });

    expect(result.template.roleName).toBe('Data Analyst');
    // 2 plain tasks + 1 seat task.
    expect(result.templateTasks).toHaveLength(3);

    const stored = await repo.templateTasks.where(
      (t) => t.templateId === result.template.id,
    );
    expect(stored).toHaveLength(3);

    // Owner team inferred from title: email -> it, laptop -> vendor.
    const byTitle = Object.fromEntries(stored.map((t) => [t.title, t]));
    expect(byTitle['Order laptop']!.ownerTeam).toBe('vendor');
    expect(byTitle['Create email + SSO']!.ownerTeam).toBe('it');

    // The seat task carries the app + recurring monthly cost.
    const seatTask = stored.find((t) => t.appId === 'notion');
    expect(seatTask).toBeDefined();
    expect(seatTask!.title).toBe('Grant Notion seat');
    expect(seatTask!.costType).toBe('recurring');
    expect(seatTask!.cost).toBe(10);
  });

  it('rejects a duplicate roleName', async () => {
    const {templates} = await setup();
    await expect(
      templates.createTemplate({
        roleName: 'Software Engineer',
        taskTitles: [],
        seatAppIds: [],
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('skips unknown seat app ids rather than failing', async () => {
    const {repo, templates} = await setup();
    const result = await templates.createTemplate({
      roleName: 'Recruiter',
      taskTitles: ['HR paperwork'],
      seatAppIds: ['does-not-exist'],
    });
    // Only the plain task is created; the unknown app is skipped.
    expect(result.templateTasks).toHaveLength(1);
    expect(result.templateTasks[0]!.ownerTeam).toBe('hr');
    const stored = await repo.templateTasks.where(
      (t) => t.templateId === result.template.id,
    );
    expect(stored).toHaveLength(1);
  });
});

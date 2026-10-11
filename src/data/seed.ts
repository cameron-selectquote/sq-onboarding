/**
 * Seed dataset (BuildPlan §4 QA workstream, §8 step 3).
 *
 * One company, ~5 teams, catalog apps, catalog asset types with a small on-hand
 * inventory, templates, hires, and budgets. Realistic enough to make the demo
 * land and to unblock the frontend before the backend is done.
 *
 * `seedData` is the raw dataset; `loadSeed(repo)` inserts it into any
 * Repository. Keep ids human-readable so they're easy to reference in the UI
 * and tests.
 */

import type {Collection, Repository} from '@/lib/repository';
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  Candidate,
  Company,
  Hire,
  License,
  Task,
  TaskStatus,
  Template,
  TemplateTask,
  User,
} from '@/lib/types';

/**
 * Cohort convention for a hire that's offboarding. The reclaim route treats
 * hires with this cohort as "assets should come back" (see the reclaim-
 * visibility spec). A stand-in for a real offboarding column — swap later
 * without touching the type contract.
 */
export const OFFBOARDING_COHORT = 'offboarding';

export interface SeedData {
  companies: Company[];
  users: User[];
  appCatalog: AppCatalogItem[];
  assetCatalog: AssetCatalogItem[];
  assets: Asset[];
  templates: Template[];
  templateTasks: TemplateTask[];
  hires: Hire[];
  tasks: Task[];
  licenses: License[];
  budgets: Budget[];
  candidates: Candidate[];
}

/** ISO timestamp `n` days before load, so idle/reclaim flags stay meaningful. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Per-hire task statuses, in template-task order. Gives the board, queues and
 * manager view a realistic spread: one ready, one blocked, one untouched.
 */
const taskStatuses: Record<string, TaskStatus[]> = {
  hire_1: ['done', 'done', 'done', 'done', 'in_progress'],
  hire_2: ['done', 'in_progress', 'done', 'todo', 'todo'],
  hire_3: ['done', 'todo', 'blocked', 'done'],
  hire_4: ['done', 'done', 'done'],
  hire_5: ['todo', 'todo', 'todo', 'todo', 'todo'],
};

/** Instantiate each hire's template tasks (what POST /api/hires/import does). */
function seedTasks(
  hires: Hire[],
  templates: Template[],
  templateTasks: TemplateTask[],
): Task[] {
  return hires.flatMap((hire) => {
    const template = templates.find((t) => t.roleName === hire.roleName);
    const statuses = taskStatuses[hire.id] ?? [];
    return templateTasks
      .filter((tt) => tt.templateId === template?.id)
      .map((tt, i) => ({
        id: `task_${hire.id}_${i + 1}`,
        hireId: hire.id,
        title: tt.title,
        ownerTeam: tt.ownerTeam,
        status: statuses[i] ?? 'todo',
        cost: tt.cost,
        costType: tt.costType,
        appId: tt.appId ?? null,
      }));
  });
}

export const seedData: SeedData = {
  companies: [
    {id: 'acme', name: 'Acme Robotics', size: 240, industry: 'Hardware'},
  ],

  users: [
    {
      id: 'u_admin',
      name: 'Avery Admin',
      email: 'avery@acme.test',
      role: 'admin',
      team: null,
      managerId: null,
    },
    {
      id: 'u_spec',
      name: 'Sam Specialist',
      email: 'sam@acme.test',
      role: 'specialist',
      team: 'hr',
      managerId: null,
    },
    {
      id: 'u_mgr',
      name: 'Morgan Manager',
      email: 'morgan@acme.test',
      role: 'manager',
      team: null,
      managerId: null,
    },
    {
      id: 'u_it',
      name: 'Ivy IT',
      email: 'ivy@acme.test',
      role: 'team_member',
      team: 'it',
      managerId: null,
    },
    {
      id: 'u_vendor',
      name: 'Val Vendor',
      email: 'val@acme.test',
      role: 'team_member',
      team: 'vendor',
      managerId: null,
    },
    {
      id: 'u_fin',
      name: 'Fin Finance',
      email: 'fin@acme.test',
      role: 'team_member',
      team: 'finance',
      managerId: null,
    },
  ],

  appCatalog: [
    {
      // Fully allocated: baseline 248 + 2 onboarding licenses = 250 / 250.
      id: 'github',
      name: 'GitHub',
      category: 'dev',
      costPerSeat: 21,
      billing: 'monthly',
      seatsOwned: 250,
      seatsInUseBaseline: 248,
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      category: 'dev',
      costPerSeat: 19,
      billing: 'monthly',
      seatsOwned: 100,
      seatsInUseBaseline: 60,
    },
    {
      id: 'slack',
      name: 'Slack',
      category: 'comms',
      costPerSeat: 8,
      billing: 'monthly',
      seatsOwned: 500,
      seatsInUseBaseline: 410,
    },
    {
      id: 'jira',
      name: 'Jira',
      category: 'pm',
      costPerSeat: 14,
      billing: 'monthly',
      seatsOwned: 200,
      seatsInUseBaseline: 120,
    },
    {
      // Fully allocated: baseline 79 + 1 onboarding license = 80 / 80.
      id: 'figma',
      name: 'Figma',
      category: 'design',
      costPerSeat: 15,
      billing: 'monthly',
      seatsOwned: 80,
      seatsInUseBaseline: 79,
    },
    {
      id: 'notion',
      name: 'Notion',
      category: 'docs',
      costPerSeat: 10,
      billing: 'monthly',
      seatsOwned: 300,
      seatsInUseBaseline: 210,
    },
    {
      id: 'zoom',
      name: 'Zoom',
      category: 'comms',
      costPerSeat: 180,
      billing: 'annual',
      seatsOwned: 150,
      seatsInUseBaseline: 95,
    },
    {
      id: 'gsuite',
      name: 'Google Workspace',
      category: 'docs',
      costPerSeat: 12,
      billing: 'monthly',
      seatsOwned: 500,
      seatsInUseBaseline: 440,
    },
    {
      id: '1password',
      name: '1Password',
      category: 'security',
      costPerSeat: 8,
      billing: 'monthly',
      seatsOwned: 500,
      seatsInUseBaseline: 455,
    },
    {
      id: 'awsworkspace',
      name: 'Amazon WorkSpaces',
      category: 'vdi',
      costPerSeat: 35,
      billing: 'monthly',
      seatsOwned: 1000,
      seatsInUseBaseline: 820,
    },
  ],

  assetCatalog: [
    {
      id: 'mbp16',
      name: 'MacBook Pro 16"',
      category: 'laptop',
      standardCost: 2800,
      depreciationMonths: 36,
    },
    {
      id: 'mon27',
      name: '27" Monitor',
      category: 'monitor',
      standardCost: 420,
      depreciationMonths: 36,
    },
    {
      id: 'badge',
      name: 'Access Badge',
      category: 'facilities',
      standardCost: 25,
      depreciationMonths: 12,
    },
    {
      id: 'iphone',
      name: 'iPhone 15',
      category: 'phone',
      standardCost: 999,
      depreciationMonths: 24,
    },
    {
      id: 'headset',
      name: 'Noise-cancelling Headset',
      category: 'peripheral',
      standardCost: 320,
      depreciationMonths: 24,
    },
  ],

  // A small on-hand inventory so assetsOnHand() is non-trivial in the demo.
  assets: [
    {
      id: 'asset_mbp_1',
      catalogId: 'mbp16',
      serialTag: 'MBP-0001',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    {
      id: 'asset_mbp_2',
      catalogId: 'mbp16',
      serialTag: 'MBP-0002',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    {
      id: 'asset_mon_1',
      catalogId: 'mon27',
      serialTag: 'MON-0001',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    {
      id: 'asset_badge_1',
      catalogId: 'badge',
      serialTag: 'BDG-0001',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    {
      id: 'asset_badge_2',
      catalogId: 'badge',
      serialTag: 'BDG-0002',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    {
      id: 'asset_headset_1',
      catalogId: 'headset',
      serialTag: 'HST-0001',
      status: 'in_stock',
      assignedToHireId: null,
      acquiredAt: '2026-01-05',
      returnedAt: null,
    },
    // Assigned to the offboarding hire — flagged pending_return by reclaim.
    {
      id: 'asset_mbp_3',
      catalogId: 'mbp16',
      serialTag: 'MBP-0003',
      status: 'assigned',
      assignedToHireId: 'hire_off',
      acquiredAt: '2025-06-01',
      returnedAt: null,
    },
  ],

  templates: [
    {id: 'tpl_swe', roleName: 'Software Engineer'},
    {id: 'tpl_designer', roleName: 'Designer'},
    {id: 'tpl_ops', roleName: 'Operations'},
  ],

  templateTasks: [
    // Software Engineer
    {
      id: 'tt_swe_1',
      templateId: 'tpl_swe',
      title: 'Create email + SSO',
      ownerTeam: 'it',
      cost: 0,
      costType: 'none',
      appId: null,
    },
    {
      id: 'tt_swe_2',
      templateId: 'tpl_swe',
      title: 'Order laptop',
      ownerTeam: 'vendor',
      cost: 2800,
      costType: 'one_time',
      appId: null,
    },
    {
      id: 'tt_swe_3',
      templateId: 'tpl_swe',
      title: 'Grant GitHub seat',
      ownerTeam: 'it',
      cost: 21,
      costType: 'recurring',
      appId: 'github',
    },
    {
      id: 'tt_swe_4',
      templateId: 'tpl_swe',
      title: 'Grant Slack seat',
      ownerTeam: 'it',
      cost: 8,
      costType: 'recurring',
      appId: 'slack',
    },
    {
      id: 'tt_swe_5',
      templateId: 'tpl_swe',
      title: 'Issue access badge',
      ownerTeam: 'facilities',
      cost: 25,
      costType: 'one_time',
      appId: null,
    },
    // Designer
    {
      id: 'tt_des_1',
      templateId: 'tpl_designer',
      title: 'Create email + SSO',
      ownerTeam: 'it',
      cost: 0,
      costType: 'none',
      appId: null,
    },
    {
      id: 'tt_des_2',
      templateId: 'tpl_designer',
      title: 'Order laptop',
      ownerTeam: 'vendor',
      cost: 2800,
      costType: 'one_time',
      appId: null,
    },
    {
      id: 'tt_des_3',
      templateId: 'tpl_designer',
      title: 'Grant Figma seat',
      ownerTeam: 'it',
      cost: 15,
      costType: 'recurring',
      appId: 'figma',
    },
    {
      id: 'tt_des_4',
      templateId: 'tpl_designer',
      title: 'Grant Slack seat',
      ownerTeam: 'it',
      cost: 8,
      costType: 'recurring',
      appId: 'slack',
    },
    // Operations
    {
      id: 'tt_ops_1',
      templateId: 'tpl_ops',
      title: 'Create email + SSO',
      ownerTeam: 'it',
      cost: 0,
      costType: 'none',
      appId: null,
    },
    {
      id: 'tt_ops_2',
      templateId: 'tpl_ops',
      title: 'Grant Notion seat',
      ownerTeam: 'it',
      cost: 10,
      costType: 'recurring',
      appId: 'notion',
    },
    {
      id: 'tt_ops_3',
      templateId: 'tpl_ops',
      title: 'Issue access badge',
      ownerTeam: 'facilities',
      cost: 25,
      costType: 'one_time',
      appId: null,
    },
  ],

  hires: [
    {
      id: 'hire_1',
      name: 'Riley Chen',
      email: 'riley@acme.test',
      roleName: 'Software Engineer',
      managerId: 'u_mgr',
      startDate: '2026-02-02',
      cohort: '2026-Feb',
    },
    {
      id: 'hire_2',
      name: 'Jordan Patel',
      email: 'jordan@acme.test',
      roleName: 'Software Engineer',
      managerId: 'u_mgr',
      startDate: '2026-02-02',
      cohort: '2026-Feb',
    },
    {
      id: 'hire_3',
      name: 'Taylor Kim',
      email: 'taylor@acme.test',
      roleName: 'Designer',
      managerId: 'u_mgr',
      startDate: '2026-02-09',
      cohort: '2026-Feb',
    },
    {
      id: 'hire_4',
      name: 'Casey Nguyen',
      email: 'casey@acme.test',
      roleName: 'Operations',
      managerId: 'u_mgr',
      startDate: '2026-02-09',
      cohort: '2026-Feb',
    },
    {
      id: 'hire_5',
      name: 'Drew Alvarez',
      email: 'drew@acme.test',
      roleName: 'Software Engineer',
      managerId: 'u_mgr',
      startDate: '2026-02-16',
      cohort: '2026-Feb',
    },
    // Offboarding hire — their assigned asset is pending return (reclaim beat).
    {
      id: 'hire_off',
      name: 'Quinn Baker',
      email: 'quinn@acme.test',
      roleName: 'Software Engineer',
      managerId: 'u_mgr',
      startDate: '2025-06-01',
      cohort: OFFBOARDING_COHORT,
    },
  ],

  tasks: [], // filled from templates below

  // Live burn plus something to reclaim: an idle seat, a seat marked for
  // reclaim, a stale active seat, and a duplicate comms app. `requested` seats
  // are asked-for-but-not-granted — IT grants them from the "Seats waiting" queue.
  licenses: [
    {
      id: 'lic_1',
      hireId: 'hire_1',
      appId: 'github',
      status: 'active',
      grantedAt: daysAgo(20),
      lastUsedAt: daysAgo(1),
    },
    {
      id: 'lic_2',
      hireId: 'hire_1',
      appId: 'slack',
      status: 'active',
      grantedAt: daysAgo(20),
      lastUsedAt: daysAgo(1),
    },
    {
      id: 'lic_3',
      hireId: 'hire_1',
      appId: 'zoom',
      status: 'active',
      grantedAt: daysAgo(20),
      lastUsedAt: daysAgo(3),
    },
    {
      id: 'lic_4',
      hireId: 'hire_2',
      appId: 'github',
      status: 'active',
      grantedAt: daysAgo(20),
      lastUsedAt: daysAgo(2),
    },
    {
      id: 'lic_5',
      hireId: 'hire_2',
      appId: 'slack',
      status: 'idle',
      grantedAt: daysAgo(60),
      lastUsedAt: daysAgo(45),
    },
    {
      id: 'lic_6',
      hireId: 'hire_3',
      appId: 'figma',
      status: 'active',
      grantedAt: daysAgo(14),
      lastUsedAt: daysAgo(1),
    },
    {
      id: 'lic_7',
      hireId: 'hire_3',
      appId: 'slack',
      status: 'reclaim',
      grantedAt: daysAgo(90),
      lastUsedAt: daysAgo(60),
    },
    {
      id: 'lic_8',
      hireId: 'hire_4',
      appId: 'notion',
      status: 'active',
      grantedAt: daysAgo(70),
      lastUsedAt: daysAgo(40),
    },
    {
      id: 'lic_9',
      hireId: 'hire_4',
      appId: 'gsuite',
      status: 'requested',
      grantedAt: null,
      lastUsedAt: null,
    },
    {
      id: 'lic_10',
      hireId: 'hire_5',
      appId: 'github',
      status: 'requested',
      grantedAt: null,
      lastUsedAt: null,
    },
    {
      id: 'lic_11',
      hireId: 'hire_5',
      appId: 'slack',
      status: 'requested',
      grantedAt: null,
      lastUsedAt: null,
    },
  ],

  budgets: [
    {id: 'bud_it', team: 'it', period: '2026-Q1', limit: 5000, spent: 0},
    {
      id: 'bud_vendor',
      team: 'vendor',
      period: '2026-Q1',
      limit: 40000,
      spent: 0,
    },
    {
      id: 'bud_facilities',
      team: 'facilities',
      period: '2026-Q1',
      limit: 2000,
      spent: 0,
    },
    {id: 'bud_hr', team: 'hr', period: '2026-Q1', limit: 3000, spent: 0},
    {
      id: 'bud_finance',
      team: 'finance',
      period: '2026-Q1',
      limit: 3000,
      spent: 0,
    },
  ],

  // Pre-hire records the Onboarding Genie searches by name. Titles map to the
  // seeded templates (Software Engineer / Designer / Operations). "Ada Byron"
  // is deliberately title-only (roleName null) to exercise the manual path.
  candidates: [
    {
      id: 'cand_1',
      name: 'Nora Alvarez',
      title: 'Senior Software Engineer',
      roleName: 'Software Engineer',
      hiringManagerId: 'u_mgr',
      resumeFile: 'nora-alvarez-resume.pdf',
      startDate: '2026-03-02',
      status: 'new',
      hireId: null,
    },
    {
      id: 'cand_2',
      name: 'Marcus Lee',
      title: 'Product Designer',
      roleName: 'Designer',
      hiringManagerId: 'u_mgr',
      resumeFile: 'marcus-lee-resume.pdf',
      startDate: '2026-03-09',
      status: 'new',
      hireId: null,
    },
    {
      id: 'cand_3',
      name: 'Priya Nair',
      title: 'Operations Coordinator',
      roleName: 'Operations',
      hiringManagerId: 'u_mgr',
      resumeFile: 'priya-nair-resume.pdf',
      startDate: '2026-03-16',
      status: 'new',
      hireId: null,
    },
    {
      id: 'cand_4',
      name: 'Ada Byron',
      title: 'Staff Software Engineer',
      roleName: null,
      hiringManagerId: 'u_mgr',
      resumeFile: 'ada-byron-resume.pdf',
      startDate: null,
      status: 'new',
      hireId: null,
    },
  ],
};

seedData.tasks = seedTasks(
  seedData.hires,
  seedData.templates,
  seedData.templateTasks,
);

/**
 * Insert a record only if its id isn't already present. Makes loading
 * idempotent: re-running skips existing rows instead of throwing on a duplicate
 * id, so loadSeed is safe to call more than once (and resilient to a prior
 * partial load).
 */
async function insertIfAbsent<T extends {id: string}>(
  collection: Collection<T>,
  record: T,
): Promise<void> {
  const existing = await collection.get(record.id);
  if (!existing) await collection.insert(record);
}

/**
 * Insert the seed dataset into a repository. Idempotent: running it again on an
 * already-seeded (or partially-seeded) repo is a no-op for rows that exist, so
 * it never throws on duplicate ids.
 */
export async function loadSeed(
  repo: Repository,
  data: SeedData = seedData,
): Promise<void> {
  for (const c of data.companies) await insertIfAbsent(repo.companies, c);
  for (const u of data.users) await insertIfAbsent(repo.users, u);
  for (const a of data.appCatalog) await insertIfAbsent(repo.appCatalog, a);
  for (const a of data.assetCatalog) await insertIfAbsent(repo.assetCatalog, a);
  for (const a of data.assets) await insertIfAbsent(repo.assets, a);
  for (const t of data.templates) await insertIfAbsent(repo.templates, t);
  for (const t of data.templateTasks)
    await insertIfAbsent(repo.templateTasks, t);
  for (const h of data.hires) await insertIfAbsent(repo.hires, h);
  for (const t of data.tasks) await insertIfAbsent(repo.tasks, t);
  for (const l of data.licenses) await insertIfAbsent(repo.licenses, l);
  for (const b of data.budgets) await insertIfAbsent(repo.budgets, b);
  for (const c of data.candidates) await insertIfAbsent(repo.candidates, c);
}

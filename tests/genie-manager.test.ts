/**
 * Manager Genie — read-only, scoped to the manager's own hires and candidates.
 *
 * The Strands SDK can't load under ts-jest (see store.ts), so these tests cover
 * the cost-free, scope-enforcing read models that back the manager tools,
 * plus the role policy. The key guarantees: own-hires only (no cross-manager
 * leakage), candidates for the manager's roles, and no dollar amounts.
 */

process.env.PROVISION_DB_PATH = ':memory:';

import {
  getManagerCandidates,
  getManagerHireDetail,
  getManagerHires,
} from '@/server/queries';
import {capabilitiesFor} from '@/lib/genie-access';
import {getServices} from '@/server/store';

const OWNER = 'u_mgr'; // seeded manager, owns all seed hires

/** Keys that would indicate a cost field leaked into manager output. */
const COST_KEYS = /monthly|cost|residual|price|amount|spend|budget|dollar/i;

function hasCostKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (COST_KEYS.test(k)) return true;
    if (hasCostKey(v)) return true;
  }
  return false;
}

/** Seed a second manager with their own hire + candidate, to prove isolation. */
async function seedOtherManager(): Promise<{hireName: string; hireId: string}> {
  const {repo} = await getServices();
  // Idempotent: the in-memory store is a singleton shared across this file's
  // tests, so only insert rows that aren't already present.
  if (!(await repo.users.get('u_mgr2'))) {
    await repo.users.insert({
      id: 'u_mgr2',
      name: 'Dana Director',
      email: 'dana@acme.test',
      role: 'manager',
      team: null,
      managerId: null,
    });
  }
  if (!(await repo.hires.get('hire_other'))) {
    await repo.hires.insert({
      id: 'hire_other',
      name: 'Pat Other',
      email: 'pat@acme.test',
      roleName: 'Platform Engineer', // a role u_mgr does NOT hire for
      managerId: 'u_mgr2',
      startDate: '2026-04-01',
      cohort: '2026-Apr',
    });
  }
  if (!(await repo.candidates.get('cand_other'))) {
    await repo.candidates.insert({
      id: 'cand_other',
      name: 'Chris Elsewhere',
      title: 'Platform Engineer',
      roleName: 'Platform Engineer',
      hiringManagerId: 'u_mgr2',
      resumeFile: null,
      startDate: null,
      status: 'new',
      hireId: null,
    });
  }
  return {hireName: 'Pat Other', hireId: 'hire_other'};
}

describe('manager policy', () => {
  it('is read-only, own-hires scoped, cost-free, no destructive tools', () => {
    const caps = capabilitiesFor('manager');
    expect(caps.allowsMutations).toBe(false);
    expect(caps.exposesCosts).toBe(false);
    expect(caps.scope).toBe('own-hires');
    expect(caps.preHandlers).toHaveLength(0);
    for (const t of [
      'executeOffboarding',
      'previewOffboarding',
      'createOnboardingPlan',
      'executeOnboardingTasks',
    ]) {
      expect(caps.tools).not.toContain(t);
    }
  });
});

describe('manager read models (own scope, cost-free)', () => {
  it("lists the manager's own hires with progress but no cost fields", async () => {
    const {repo} = await getServices();
    const mine = await repo.hires.where((h) => h.managerId === OWNER);
    const rows = await getManagerHires(OWNER);

    expect(rows.map((r) => r.hireId).sort()).toEqual(
      mine.map((h) => h.id).sort(),
    );
    expect(hasCostKey(rows)).toBe(false);
    for (const r of rows) expect(typeof r.done).toBe('number');
  });

  it('hire detail carries software/hardware but strips every dollar field', async () => {
    const detail = await getManagerHireDetail(OWNER, 'hire_1');
    expect(detail?.name).toBe('Riley Chen');
    expect(Array.isArray(detail?.software)).toBe(true);
    expect(Array.isArray(detail?.hardware)).toBe(true);
    // Seat/asset entries must have NO monthly/residual.
    expect(hasCostKey(detail)).toBe(false);
    for (const s of detail!.software) {
      expect(Object.keys(s).sort()).toEqual(['app', 'status']);
    }
  });

  it("candidates are those for the manager's roles, no costs", async () => {
    const rows = await getManagerCandidates(OWNER);
    const names = rows.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Nora Alvarez']));
    expect(hasCostKey(rows)).toBe(false);
  });

  it("fails closed on another manager's hire (no cross-manager leakage)", async () => {
    const {hireId} = await seedOtherManager();
    // The owning manager cannot pull up a hire that isn't theirs.
    expect(await getManagerHireDetail(OWNER, hireId)).toBeNull();

    // The other manager's hire never appears in the owner's list.
    const rows = await getManagerHires(OWNER);
    expect(rows.map((r) => r.hireId)).not.toContain(hireId);

    // And the other manager's candidate (a role u_mgr doesn't hire for) is out.
    const cands = await getManagerCandidates(OWNER);
    expect(cands.map((c) => c.id)).not.toContain('cand_other');
  });

  it('the other manager sees only their own hire', async () => {
    await seedOtherManager();
    const rows = await getManagerHires('u_mgr2');
    expect(rows.map((r) => r.name)).toEqual(['Pat Other']);
  });
});

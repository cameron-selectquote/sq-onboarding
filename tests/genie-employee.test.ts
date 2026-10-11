/**
 * Employee Genie — the slimmed-down concierge for a new hire.
 *
 * The Strands SDK is ESM-only and can't be imported under ts-jest's CommonJS
 * runtime (see src/server/store.ts for why), so these tests exercise the
 * cost-free read models that back the employee tools directly, plus the role
 * policy. That's where SCOPE is actually enforced: an employee sees company +
 * self info, never a dollar amount, and never another person.
 */

// Ephemeral in-memory store so the seed loads fresh and nothing touches the
// on-disk dev DB. Set before the store resolves its path (lazy, first call).
process.env.PROVISION_DB_PATH = ':memory:';

import {
  getCompanyInfo,
  getManagerForHire,
  getMyRoleInfo,
  getOnboardingNorms,
} from '@/server/queries';
import {capabilitiesFor} from '@/lib/genie-access';
import {getServices} from '@/server/store';

/** The signed-in employee's own hire. */
const EMPLOYEE_HIRE = 'hire_1'; // Riley Chen, Software Engineer, manager u_mgr
const OTHER_HIRE = 'hire_2'; // Jordan Patel — must never surface for the employee

/** Recursively collect every string + number value in an object graph. */
function flattenValues(value: unknown, acc: unknown[] = []): unknown[] {
  if (value === null || value === undefined) return acc;
  if (Array.isArray(value)) {
    for (const v of value) flattenValues(v, acc);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) flattenValues(v, acc);
  } else {
    acc.push(value);
  }
  return acc;
}

/** Keys that would indicate a cost field leaked into employee output. */
const COST_KEYS = /monthly|cost|residual|price|amount|spend|budget|dollar/i;

function hasCostKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value)) {
    if (COST_KEYS.test(k)) return true;
    if (hasCostKey(v)) return true;
  }
  return false;
}

describe('employee policy', () => {
  it('exposes no costs, no mutations, and self scope', () => {
    const caps = capabilitiesFor('employee');
    expect(caps.exposesCosts).toBe(false);
    expect(caps.allowsMutations).toBe(false);
    expect(caps.scope).toBe('self');
    expect(caps.tools).toEqual([
      'getCompanyInfo',
      'getMyRoleInfo',
      'getMyManager',
      'getOnboardingNorms',
    ]);
  });
});

describe('employee read models (cost-free, self-scoped)', () => {
  it('getCompanyInfo returns name/size/industry only — no cost fields', async () => {
    const info = await getCompanyInfo();
    expect(info).toEqual({
      name: 'Acme Robotics',
      size: 240,
      industry: 'Hardware',
    });
    expect(hasCostKey(info)).toBe(false);
  });

  it("getMyManager returns the hire's own manager, name + email only", async () => {
    const {repo} = await getServices();
    const hire = await repo.hires.get(EMPLOYEE_HIRE);
    const manager =
      hire?.managerId ? await repo.users.get(hire.managerId) : null;

    const mgr = await getManagerForHire(EMPLOYEE_HIRE);
    expect(mgr).toEqual({name: manager!.name, email: manager!.email});
    expect(hasCostKey(mgr)).toBe(false);
  });

  it('getMyRoleInfo carries the role + a cost-free checklist, no money', async () => {
    const info = await getMyRoleInfo(EMPLOYEE_HIRE);
    expect(info?.roleName).toBe('Software Engineer');
    expect(info?.tasks.length).toBeGreaterThan(0);
    // No cost key anywhere in the payload, and no other hire's name.
    expect(hasCostKey(info)).toBe(false);

    const {repo} = await getServices();
    const other = await repo.hires.get(OTHER_HIRE);
    const values = flattenValues(info).filter((v) => typeof v === 'string');
    expect(values).not.toContain(other!.name);
  });

  it('getOnboardingNorms is general guidance with a day count, no costs', async () => {
    const norms = await getOnboardingNorms();
    expect(norms.averageDays).toBeGreaterThan(0);
    expect(norms.milestones.length).toBeGreaterThan(0);
    expect(hasCostKey(norms)).toBe(false);
  });

  it("a missing hire record yields null rather than another hire's data", async () => {
    expect(await getMyRoleInfo('nope')).toBeNull();
    expect(await getManagerForHire('nope')).toBeNull();
  });
});

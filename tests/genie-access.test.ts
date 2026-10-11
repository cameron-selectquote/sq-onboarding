import {
  ADMIN_GREETING,
  ADMIN_SYSTEM_PROMPT,
  allowsPreHandler,
  allowsTool,
  capabilitiesFor,
  greetingFor,
  promptFor,
  type GenieRole,
  type GenieToolName,
} from '@/lib/genie-access';

const ROLES: GenieRole[] = ['admin', 'manager', 'employee'];

/** Tools that mutate data or carry out an action (never for non-admins). */
const MUTATING_TOOLS: GenieToolName[] = [
  'createOnboardingPlan',
  'executeOnboardingTasks',
  'previewOffboarding',
  'executeOffboarding',
];

describe('capabilitiesFor', () => {
  it('gives admin the full superset of tools', () => {
    const admin = capabilitiesFor('admin');
    expect(admin.tools).toEqual([
      'searchCandidateRecords',
      'createOnboardingPlan',
      'executeOnboardingTasks',
      'previewOffboarding',
      'executeOffboarding',
      'draftWelcomeBrief',
      'viewHireStatus',
    ]);
    expect(admin.scope).toBe('all');
    expect(admin.exposesCosts).toBe(true);
    expect(admin.allowsMutations).toBe(true);
  });

  it('manager is read-only, own-hires scoped, and never exposes costs', () => {
    const mgr = capabilitiesFor('manager');
    expect(mgr.exposesCosts).toBe(false);
    expect(mgr.allowsMutations).toBe(false);
    expect(mgr.scope).toBe('own-hires');
    // No mutating tools, no offboarding, no admin pre-handlers.
    for (const t of MUTATING_TOOLS) expect(mgr.tools).not.toContain(t);
    expect(mgr.tools).not.toContain('searchCandidateRecords');
    expect(mgr.preHandlers).toHaveLength(0);
    // Only the three read-only manager tools.
    expect(mgr.tools).toEqual(['listMyHires', 'viewMyHireDetail', 'listMyCandidates']);
  });

  it('employee is self-scoped, cost-free, and limited to company/self reads', () => {
    const emp = capabilitiesFor('employee');
    expect(emp.exposesCosts).toBe(false);
    expect(emp.allowsMutations).toBe(false);
    expect(emp.scope).toBe('self');
    expect(emp.preHandlers).toHaveLength(0);
    for (const t of MUTATING_TOOLS) expect(emp.tools).not.toContain(t);
    // No candidate search, no hire status, no manager-scope tools.
    for (const t of [
      'searchCandidateRecords',
      'viewHireStatus',
      'listMyHires',
      'viewMyHireDetail',
      'listMyCandidates',
    ] as GenieToolName[]) {
      expect(emp.tools).not.toContain(t);
    }
    expect(emp.tools).toEqual([
      'getCompanyInfo',
      'getMyRoleInfo',
      'getMyManager',
      'getOnboardingNorms',
    ]);
  });

  it('only admin may expose costs or mutate', () => {
    for (const role of ROLES) {
      const caps = capabilitiesFor(role);
      expect(caps.exposesCosts).toBe(role === 'admin');
      expect(caps.allowsMutations).toBe(role === 'admin');
    }
  });

  it('fails closed for an unknown role (least privilege)', () => {
    const caps = capabilitiesFor('ghost' as GenieRole);
    expect(caps.allowsMutations).toBe(false);
    expect(caps.exposesCosts).toBe(false);
  });
});

describe('allowsTool / allowsPreHandler', () => {
  it('only admin may run the destructive offboard tool + gate', () => {
    expect(allowsTool('admin', 'executeOffboarding')).toBe(true);
    expect(allowsTool('manager', 'executeOffboarding')).toBe(false);
    expect(allowsTool('employee', 'executeOffboarding')).toBe(false);

    expect(allowsPreHandler('admin', 'offboard')).toBe(true);
    expect(allowsPreHandler('manager', 'offboard')).toBe(false);
    expect(allowsPreHandler('employee', 'offboard')).toBe(false);
  });

  it('non-admins cannot trigger the seat-removal or list-candidates pre-handlers', () => {
    for (const h of ['removeSeat', 'listCandidates', 'templateBuilder'] as const) {
      expect(allowsPreHandler('manager', h)).toBe(false);
      expect(allowsPreHandler('employee', h)).toBe(false);
    }
  });
});

describe('promptFor / greetingFor', () => {
  it('admin reuses the original prompt + greeting', () => {
    expect(promptFor('admin')).toBe(ADMIN_SYSTEM_PROMPT);
    expect(greetingFor('admin')).toBe(ADMIN_GREETING);
  });

  it('each role gets a distinct prompt and greeting', () => {
    const prompts = ROLES.map(promptFor);
    expect(new Set(prompts).size).toBe(ROLES.length);
    const greetings = ROLES.map(greetingFor);
    expect(new Set(greetings).size).toBe(ROLES.length);
  });

  it('non-admin prompts forbid costs', () => {
    expect(promptFor('manager').toLowerCase()).toContain('cost');
    expect(promptFor('employee').toLowerCase()).toContain('cost');
  });
});

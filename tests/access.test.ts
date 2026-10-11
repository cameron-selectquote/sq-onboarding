import {
  ROLES,
  canAccess,
  canCallApi,
  canOpenPath,
  canSwitchRole,
  homePathFor,
  isAppRole,
  navFor,
  viewForPath,
  viewsFor,
} from '@/lib/access';
import {DEMO_ACCOUNTS, findAccount} from '@/lib/accounts';

describe('role views', () => {
  it('only admin sees finance, the board, and the team queues', () => {
    for (const role of ROLES) {
      for (const view of [
        'finance',
        'specialist',
        'team:it',
        'team:vendor',
        'team:facilities',
        'api-docs',
      ] as const) {
        expect(canAccess(role, view)).toBe(role === 'admin');
      }
    }
  });

  it('manager sees home, the manager report, and the shared Genie', () => {
    expect(viewsFor('manager')).toEqual(['home', 'manager', 'genie']);
  });

  it('employee sees home, their checklist, and the shared Genie', () => {
    expect(viewsFor('employee')).toEqual(['home', 'myonboarding', 'genie']);
  });

  it('every role lands on /home', () => {
    for (const role of ROLES) expect(homePathFor(role)).toBe('/home');
  });

  it('validates role values', () => {
    expect(isAppRole('admin')).toBe(true);
    expect(isAppRole('finance')).toBe(false);
    expect(isAppRole(undefined)).toBe(false);
  });

  it('only admins may switch roles', () => {
    expect(canSwitchRole('admin')).toBe(true);
    expect(canSwitchRole('manager')).toBe(false);
    expect(canSwitchRole('employee')).toBe(false);
  });
});

describe('path access', () => {
  it('maps page paths to views', () => {
    expect(viewForPath('/home')).toBe('home');
    expect(viewForPath('/finance/reclaim')).toBe('finance');
    expect(viewForPath('/team/it')).toBe('team:it');
    expect(viewForPath('/specialist/genie')).toBe('specialist');
    expect(viewForPath('/genie')).toBe('genie');
    expect(viewForPath('/api-docs')).toBe('api-docs');
    expect(viewForPath('/financeX')).toBeNull();
  });

  it('employee can open home, their checklist, and the shared Genie', () => {
    expect(canOpenPath('employee', '/home')).toBe(true);
    expect(canOpenPath('employee', '/myonboarding')).toBe(true);
    expect(canOpenPath('employee', '/genie')).toBe(true);
    for (const p of [
      '/finance',
      '/specialist',
      '/manager',
      '/manager/hire_1',
      '/team/it',
      '/api-docs',
      '/unknown',
    ]) {
      expect(canOpenPath('employee', p)).toBe(false);
    }
  });

  it('manager can open the manager drill-down and Genie but not finance', () => {
    expect(canOpenPath('manager', '/manager/hire_1')).toBe(true);
    expect(canOpenPath('manager', '/genie')).toBe(true);
    expect(canOpenPath('manager', '/finance')).toBe(false);
    expect(canOpenPath('manager', '/myonboarding')).toBe(false);
  });

  it('admin can open everything', () => {
    for (const p of [
      '/home',
      '/finance/reclaim',
      '/specialist/hires',
      '/team/facilities',
      '/manager',
      '/myonboarding',
      '/api-docs',
    ]) {
      expect(canOpenPath('admin', p)).toBe(true);
    }
  });

  it('employee can call no API; admin and manager can', () => {
    expect(canCallApi('employee')).toBe(false);
    expect(canCallApi('manager')).toBe(true);
    expect(canCallApi('admin')).toBe(true);
  });
});

describe('sidebar nav', () => {
  const hrefs = (role: (typeof ROLES)[number]) =>
    navFor(role).flatMap((s) => s.items.map((i) => i.href));

  it('only lists pages the role can open', () => {
    for (const role of ROLES) {
      for (const href of hrefs(role))
        expect(canOpenPath(role, href.split('?')[0]!)).toBe(true);
    }
  });

  it('employee nav has home, their checklist, and Genie — no finance/admin', () => {
    expect(hrefs('employee')).toEqual(['/home', '/myonboarding', '/genie']);
  });

  it('admin nav reaches every section', () => {
    const all = hrefs('admin');
    for (const href of [
      '/home',
      '/specialist',
      '/finance',
      '/finance/reclaim',
      '/team/it',
      '/manager',
      '/myonboarding',
      '/api-docs',
    ]) {
      expect(all).toContain(href);
    }
  });
});

describe('demo accounts', () => {
  it('has one account per role', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.role).sort()).toEqual([...ROLES].sort());
  });

  it('only the employee account is tied to a hire', () => {
    for (const a of DEMO_ACCOUNTS)
      expect(a.hireId !== null).toBe(a.role === 'employee');
  });

  it('finds accounts case-insensitively, ignoring whitespace', () => {
    expect(findAccount(' Admin ')?.role).toBe('admin');
    expect(findAccount('nobody')).toBeNull();
    expect(findAccount('')).toBeNull();
  });
});

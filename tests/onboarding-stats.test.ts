import {
  averageOnboardingDays,
  BASELINE_ONBOARDING_DAYS,
  onboardingNorms,
  ONBOARDING_MILESTONES,
} from '@/lib/onboarding-stats';
import type {Task} from '@/lib/types';

/** Make `n` throwaway tasks for one hire (only the count matters here). */
function tasksForHire(hireId: string, n: number): Task[] {
  return Array.from({length: n}, (_, i) => ({
    id: `${hireId}_t${i}`,
    hireId,
    title: `Task ${i}`,
    ownerTeam: 'it',
    status: 'done',
    cost: 0,
    costType: 'none',
    appId: null,
  }));
}

describe('averageOnboardingDays', () => {
  it('falls back to the company baseline with no data', () => {
    expect(averageOnboardingDays([])).toBe(BASELINE_ONBOARDING_DAYS);
    expect(averageOnboardingDays([[], []])).toBe(BASELINE_ONBOARDING_DAYS);
  });

  it('sits at baseline for a ~4-task average', () => {
    const byHire = [tasksForHire('h1', 4), tasksForHire('h2', 4)];
    expect(averageOnboardingDays(byHire)).toBe(BASELINE_ONBOARDING_DAYS);
  });

  it('nudges up for task-heavy roles and down for light ones', () => {
    const heavy = averageOnboardingDays([tasksForHire('h', 10)]);
    const light = averageOnboardingDays([tasksForHire('h', 2)]);
    expect(heavy).toBeGreaterThan(BASELINE_ONBOARDING_DAYS);
    expect(light).toBeLessThan(BASELINE_ONBOARDING_DAYS);
  });

  it('stays within a believable 14–60 day band', () => {
    const huge = averageOnboardingDays([tasksForHire('h', 1000)]);
    const tiny = averageOnboardingDays([tasksForHire('h', 1)]);
    expect(huge).toBeLessThanOrEqual(60);
    expect(tiny).toBeGreaterThanOrEqual(14);
  });

  it('is deterministic for a given input', () => {
    const byHire = [tasksForHire('h1', 5), tasksForHire('h2', 3)];
    expect(averageOnboardingDays(byHire)).toBe(averageOnboardingDays(byHire));
  });
});

describe('onboardingNorms', () => {
  it('reports the sample size and shared milestones', () => {
    const norms = onboardingNorms([tasksForHire('h1', 5), []]);
    expect(norms.sampleSize).toBe(1); // the empty hire doesn't count
    expect(norms.baselineDays).toBe(BASELINE_ONBOARDING_DAYS);
    expect(norms.milestones).toEqual([...ONBOARDING_MILESTONES]);
    expect(norms.averageDays).toBeGreaterThan(0);
  });
});

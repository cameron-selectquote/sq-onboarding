/**
 * Onboarding norms (pure).
 *
 * The employee concierge answers "how long does onboarding usually take?" and
 * "what happens in my first weeks?". The data model has no per-task completion
 * timestamps, so we can't measure real elapsed spans. Instead this derives a
 * nominal onboarding window from the shape of the data we DO have — the number
 * of onboarding tasks a role carries — around a company baseline, and exposes
 * the standard 30/60/90 milestones every role view already talks about.
 *
 * Pure functions over plain records: no DB, no clock, no network. The caller
 * passes the records; the result is deterministic for a given input.
 */

import type {Task} from './types';

/** Company-wide baseline onboarding window, in days, used as the anchor. */
export const BASELINE_ONBOARDING_DAYS = 30;

/** Rough extra days each onboarding task adds to the nominal window. */
const DAYS_PER_TASK = 2;

export interface OnboardingNorms {
  /** Typical onboarding length in days (nominal, not measured). */
  averageDays: number;
  /** The company baseline the estimate is anchored to. */
  baselineDays: number;
  /** How many hires informed the estimate (0 => baseline only). */
  sampleSize: number;
  /** The 30/60/90-day milestones every role shares. */
  milestones: string[];
}

/** The standard milestones surfaced to a new hire (cost-free, generic). */
export const ONBOARDING_MILESTONES: readonly string[] = [
  'Day 1: meet your manager, get your accounts, and get oriented.',
  'Week 1: meet the team and finish any role-specific setup and training.',
  'Weeks 2–4: set your 30/60/90 goals with your manager, with a first check-in at the end of month one.',
];

/**
 * Average the per-hire onboarding task counts into a nominal onboarding window.
 * `tasksByHire` is each hire's task list (one array per hire). An empty input,
 * or hires with no tasks, falls back to the company baseline so the concierge
 * always has a sensible answer.
 */
export function averageOnboardingDays(tasksByHire: Task[][]): number {
  const withTasks = tasksByHire.filter((tasks) => tasks.length > 0);
  if (withTasks.length === 0) return BASELINE_ONBOARDING_DAYS;

  const avgTaskCount =
    withTasks.reduce((sum, tasks) => sum + tasks.length, 0) / withTasks.length;

  // Anchor to the baseline, nudged by how task-heavy onboarding is on average.
  // A 5-task role lands a touch above baseline; a 3-task role a touch below.
  const estimate =
    BASELINE_ONBOARDING_DAYS + (avgTaskCount - 4) * DAYS_PER_TASK;

  // Keep it in a believable band regardless of input.
  return Math.max(14, Math.min(60, Math.round(estimate)));
}

/** Build the full onboarding-norms summary from each hire's task list. */
export function onboardingNorms(tasksByHire: Task[][]): OnboardingNorms {
  const withTasks = tasksByHire.filter((tasks) => tasks.length > 0);
  return {
    averageDays: averageOnboardingDays(tasksByHire),
    baselineDays: BASELINE_ONBOARDING_DAYS,
    sampleSize: withTasks.length,
    milestones: [...ONBOARDING_MILESTONES],
  };
}

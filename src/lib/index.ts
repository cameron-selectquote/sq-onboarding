/**
 * Barrel export for the domain core.
 *
 * API routes and the frontend import from "@/lib" — a stable surface that hides
 * which file a thing lives in. Keep this list curated.
 */

export * from './types';
export * from './repository';
export * from './memory-repository';
export * from './sqlite-repository';
export * from './ids';
export * from './cohorts';
export * from './intent';
export * from './genie-access';
export * from './onboarding-stats';
export * from './ledger';
export * from './notifications';
export * from './finance';
export * from './reclaim';
export * from './progress';
export * from './templates';
export * from './licenses';
export * from './reclaim-tasks';
export * from './assets';
export * from './candidates';
export * from './plan';
export * from './onboarding';
export * from './offboarding';
export * from './ai';

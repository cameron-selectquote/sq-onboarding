/**
 * Cohort conventions.
 *
 * `OFFBOARDING_COHORT` marks a hire that's leaving: the reclaim engine treats
 * their assigned assets as pending-return, and the active-hire views (home,
 * specialist board, manager) filter them out. A stand-in for a real
 * offboarding column — swap later without touching the type contract.
 *
 * Lives in `lib` (not `data/seed`) so domain services can depend on it without
 * importing seed data. `@/data/seed` re-exports it for backward compatibility.
 */
export const OFFBOARDING_COHORT = 'offboarding';

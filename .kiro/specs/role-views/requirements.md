# Requirements — Role views

> Example spec. The 8 UI pages are the Web Dev workstream (BuildPlan §4). The
> API they build against already exists under `src/app/api`.

## Problem / goal

The domain core and API routes are live, but there's no UI beyond a placeholder.
We need the role-scoped pages that make the 5-beat demo visible: a specialist
board, a finance dashboard, team queues, and the new-hire checklist. These pages
are how the "live burn tick-up" and "reclaim banner goes green" beats actually
land on screen.

## User stories

- As a **specialist**, I want a board of hires and their tasks, so that I can
  drive onboarding and move tasks across statuses.
- As a **finance** user, I want cost-per-hire, recurring burn, run-rate, and
  reclaimable totals, so that I can see spend as it happens.
- As a **team member** (it/vendor/facilities), I want a queue of tasks for my
  team, so that I can grant seats, raise POs, and work my items.
- As a **new hire**, I want my own onboarding checklist, so that I know what's
  happening — **without seeing any costs**.
- As a **manager**, I want a progress report for my hires.

## Acceptance criteria

1. WHEN a user opens the **finance** view THE SYSTEM SHALL display recurring
   monthly burn, total spend, reclaimable, and assets-on-hand from
   `GET /api/finance/summary`.
2. WHEN a specialist moves a task THE SYSTEM SHALL call `PATCH /api/tasks/:id`
   and reflect the new status without a full reload.
3. WHEN a seat is granted or revoked THE SYSTEM SHALL update the finance burn
   figure (poll or refresh is acceptable — realtime is a cut line).
4. WHILE viewing the **new-hire** page THE SYSTEM SHALL NOT render any dollar
   amount, cost, or budget figure.
5. IF the current role lacks access to a view THEN THE SYSTEM SHALL not expose
   that view's data.

## Out of scope

- Real auth. For the first pass, role can be a selector / query param; DevOps
  wires Supabase auth later.
- Realtime websockets — poll or refresh-on-action (BuildPlan §6 cut line 1).
- Pixel-exact mockup fidelity — match the design language, don't block on it.

## Dependencies / contract impact

- None to `src/lib/types.ts` or `schema.sql` — these pages consume existing
  endpoints. If a view needs data no endpoint returns, add the endpoint first
  (see `structure.md` → "A new API endpoint").

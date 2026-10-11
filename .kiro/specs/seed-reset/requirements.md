# Requirements — Seed reset

> The store is now a file-backed SQLite DB that persists across restarts and
> only seeds when empty. Great for a stable dev endpoint, but once you've
> clicked through a demo the data is dirty and there's no quick way back to a
> clean slate. This spec adds a dev-only endpoint that wipes the store and
> reloads the seed.

## Problem / goal

Now that we have a dev endpoint to show off, the backing SQLite file
(`data/provision.sqlite`) keeps whatever state the last run left behind: granted
seats, revoked licenses, returned assets, ledger entries. `loadSeed` is
idempotent and skips existing ids, so it will **not** restore a dirtied row —
re-running it does nothing useful. Between demo takes we need a one-call reset
that returns the store to its exact seeded state so the never-cut chain
(import → tasks → grant seat → live burn → PO burn-down → reclaim) always starts
from the same red-banner baseline.

This is explicitly a temporary convenience for development and demos, not a
production feature.

## User stories

- As a **demo driver**, I want a single call that resets the data to the seeded
  baseline, so that I can re-run the demo from a clean state without restarting
  the server or deleting files by hand.
- As a **developer**, I want to reset the store after poking at the API, so that
  my manual testing doesn't leave the dataset in a confusing state.
- As a **developer**, I want the reset endpoint to be unavailable in a
  production build, so that a temp tool can't wipe real data.

## Acceptance criteria

> EARS-style, testable.

1. WHEN a client calls `POST /api/dev/reset` in a non-production environment THE
   SYSTEM SHALL remove all existing records from every collection and reload the
   seed dataset.
2. WHEN the reset completes THE SYSTEM SHALL return a JSON body summarizing what
   was loaded (e.g. per-collection counts) with HTTP 200.
3. WHEN the reset completes THE SYSTEM SHALL leave the store in a state
   byte-for-byte equivalent to a fresh seed — a subsequent `GET /api/reclaim`
   SHALL report the same `reclaimableTotal` as a first-boot store (the banner is
   red again).
4. WHILE the reset is running THE SYSTEM SHALL perform the wipe-and-reload so
   that a concurrent read never observes a partially-seeded store (reset is
   atomic from a reader's perspective).
5. IF the app is running in production (`NODE_ENV === 'production'`) THEN THE
   SYSTEM SHALL refuse the request with HTTP 404 (or 403) and make no change to
   the store.
6. WHEN reset is called twice in a row THE SYSTEM SHALL produce the same seeded
   state both times (idempotent outcome).

## Out of scope

- Any UI affordance — this is an API-only dev tool. A button can come later if
  the demo wants one.
- Authentication / per-user authorization. The production guard is the only gate;
  there is no auth layer in the app yet.
- Resetting to anything other than the committed seed (no "snapshot current
  state" or custom datasets).
- Preserving the optional backdated ledger history (`@/data/history`). Reset
  reloads the base seed; whether to re-run history is a design call, not a
  requirement — see design.

## Dependencies / contract impact

- No change to `src/lib/types.ts` or `schema.sql`.
- The `Repository` / `Collection` interface currently has no bulk-clear
  operation. `Collection` exposes `list()` and `remove(id)`, so a reset can be
  built on existing methods, but a dedicated `clear()` (or a repo-level
  `reset()`) is cleaner and faster. Adding one to the interface is a seam change
  that both `MemoryRepository` and `SqliteRepository` must implement — flag it
  to the team. See design for the recommended shape.
- Reset must invalidate/rebuild the cached services on `globalThis` (see
  `src/server/store.ts`) or operate on the live repo in place, so the running
  process sees the reseeded data.

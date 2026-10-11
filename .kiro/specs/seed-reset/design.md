# Design — Seed reset

> A dev-only `POST /api/dev/reset` that truncates every collection and reloads
> the committed seed, returning the store to its first-boot baseline.

## Approach

The work belongs in a small store-level helper, not in the route. The route is
the thin guard-and-delegate layer the steering demands; the actual
wipe-and-reload lives next to the seeding logic in `src/server/store.ts` as a
`resetStore()` function, which calls a new repo-level `reset()` and then
re-runs `loadSeed`.

Two layers:

1. **Repository seam** — add `clear()` to the `Collection` interface and a
   `reset()` convenience on `Repository`. `SqliteRepository.reset()` deletes
   every table inside a single transaction (fast, atomic from a reader's view);
   `MemoryRepository.reset()` empties each map. Building reset on the interface
   (rather than ad-hoc `list()` + `remove()` loops in the route) keeps the
   layering rule intact and gives tests a clean primitive.

2. **Store orchestration** — `resetStore()` in `src/server/store.ts` grabs the
   live services, calls `repo.reset()`, awaits `loadSeed(repo)`, optionally
   re-runs `loadOptionalHistory(repo)`, and refreshes the
   `__provisionSeeded` promise so `getServices()` stays consistent. Because all
   routes share the one cached repo instance, resetting it in place is enough —
   no need to tear down and rebuild the SQLite handle.

The route (`src/app/api/dev/reset/route.ts`) does three things: refuse in
production, call `resetStore()`, return the summary.

## Where it lives

- `src/lib/repository.ts` — add `clear(): Promise<void>` to `Collection<T>` and
  `reset(): Promise<void>` to `Repository`. (Contract change — tell the team.)
- `src/lib/sqlite-repository.ts` — implement `SqliteCollection.clear()`
  (`DELETE FROM "<table>"`) and `SqliteRepository.reset()` wrapping all deletes
  in `this.db.transaction(...)`. Respect FK order or toggle `foreign_keys` off
  for the duration of the transaction.
- `src/lib/memory-repository.ts` — implement `clear()` (empty the backing map)
  and `reset()` (clear every collection).
- `src/server/store.ts` — add `resetStore(): Promise<ResetSummary>` and reset
  the `__provisionSeeded` promise so subsequent `getServices()` awaits the fresh
  load.
- `src/app/api/dev/reset/route.ts` — the thin guarded POST handler.
- `tests/seed-reset.test.ts` — unit coverage over `MemoryRepository.reset()` +
  `loadSeed` round-trip, and the dirty-then-reset invariant.

## Data / contract

No new types and no `schema.sql` change — the seed and tables are unchanged.
The only contract impact is the two new interface methods:

```ts
// repository.ts
export interface Collection<T extends {id: string}> {
  // ...existing...
  clear(): Promise<void>;
}

export interface Repository {
  // ...existing collections...
  reset(): Promise<void>; // clears every collection
}
```

`ResetSummary` is a route-local shape, not a domain type:

```ts
interface ResetSummary {
  ok: true;
  reseeded: true;
  counts: Record<string, number>; // collection name -> row count after reseed
}
```

## Service / API surface

`POST /api/dev/reset`

- Request body: none.
- Production (`process.env.NODE_ENV === 'production'`): respond `404` with
  `{ error: "not found" }`, no store mutation. 404 (not 403) so the endpoint is
  effectively invisible in prod.
- Otherwise: `await resetStore()`, respond `200` with `ResetSummary`.

`resetStore()` in `store.ts`:

```ts
export async function resetStore(): Promise<ResetSummary>
```

Clears the repo, reloads the seed (and optional history), rebuilds the seed
promise, returns per-collection counts.

### History on reset — decision

The base seed is the demo baseline and must come back. The optional backdated
`@/data/history` (gitignored, dev-only trend data) is a judgment call: re-running
it keeps trend charts populated after a reset, which is usually what a demo
wants. Default to **re-running history if the module is present**, mirroring
first-boot behavior, so reset == fresh boot. Keep it behind the same
try/catch so a missing module is a no-op.

## Testing strategy

Pure-ish, deterministic, no network:

1. **Round-trip** — seed a `MemoryRepository`, assert non-empty, `reset()`,
   assert empty, `loadSeed` again, assert counts match the original. Use
   `MemoryRepository` directly (no SQLite file in unit tests).
2. **Dirty-then-reset invariant** — load seed, mutate state (revoke a license,
   insert an extra hire), run the reset path, assert the store matches a
   freshly-seeded store (same license statuses, no stray hire).
3. **Collection.clear()** — empties a populated collection and is a no-op on an
   empty one.

The production guard is a one-line env check; cover it with a route-level test
only if cheap (set `NODE_ENV` and assert 404), otherwise rely on manual
verification since route handlers aren't in the `src/lib/**` coverage target.

## Risks / cut line

- **FK constraints on bulk delete.** SQLite with `foreign_keys = ON` can reject
  deletes in the wrong order. Mitigation: wrap in a transaction and either
  delete children-before-parents or `PRAGMA defer_foreign_keys` / toggle
  `foreign_keys` off within the transaction. Verify against the real schema.
- **Stale cached services.** If `__provisionSeeded` isn't refreshed, a route
  could await a resolved-but-stale promise. Mitigation: reassign the promise
  inside `resetStore()`.
- **Prod guard is the only gate.** If `NODE_ENV` isn't `production` in a
  deployed demo, the endpoint is live. Acceptable for a 24h build; note it in the
  README so nobody points it at real data.
- **Cut line:** if the interface change is too much churn mid-build, fall back to
  a route-local wipe using existing `list()` + `remove()` loops over each
  collection. Slower and uglier, but no contract change. Prefer the `reset()`
  seam if time allows.

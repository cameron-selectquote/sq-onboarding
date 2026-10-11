# Tasks — Seed reset

> Ordered, checkable steps. Each leaves the build green (`npm test` +
> `npm run build` pass). Prefer the `reset()` seam; the route-local fallback is
> the cut line in design.md if the interface change gets heavy.

- [ ] 1. Extend the Repository seam
  - Add `clear(): Promise<void>` to `Collection<T>` and `reset(): Promise<void>`
    to `Repository` in `src/lib/repository.ts`.
  - This is a contract change — flag it to the team.
  - _Requirements: 1, 4_

- [ ] 2. Implement `clear()` / `reset()` on both repositories
  - `MemoryRepository`: empty each backing map; `reset()` clears every
    collection.
  - `SqliteRepository`: `SqliteCollection.clear()` runs `DELETE FROM "<table>"`;
    `reset()` wraps all deletes in a single `db.transaction(...)`, handling FK
    order (delete children first, or toggle/defer `foreign_keys` inside the txn).
  - _Requirements: 1, 4_

- [ ] 3. Unit test the reset primitive
  - `tests/seed-reset.test.ts`: seed a `MemoryRepository`, assert non-empty,
    `reset()`, assert empty, `loadSeed` again, assert counts match the original.
  - Add the dirty-then-reset invariant: mutate state, reset, assert it matches a
    fresh seed.
  - Cover `Collection.clear()` on populated and empty collections.
  - _Requirements: 3, 6_

- [ ] 4. Add `resetStore()` to the store
  - In `src/server/store.ts`: `resetStore()` grabs the live repo, calls
    `repo.reset()`, awaits `loadSeed(repo)`, re-runs `loadOptionalHistory(repo)`,
    reassigns `__provisionSeeded`, and returns per-collection counts.
  - _Requirements: 1, 2, 3, 4, 6_

- [ ] 5. Wire the thin API route
  - `src/app/api/dev/reset/route.ts`: `POST` only. If
    `process.env.NODE_ENV === 'production'` return 404 with no mutation;
    otherwise `await resetStore()` and return 200 with the summary.
  - Keep the handler under ~30 lines.
  - _Requirements: 1, 2, 5_

- [ ] 6. Document and verify
  - Note the dev-only endpoint and its prod guard in `README.md` so nobody
    points it at real data.
  - Manually verify the loop: dirty the store (revoke a seat), `POST /api/dev/reset`,
    confirm `GET /api/reclaim` is back to the red-banner baseline.
  - _Requirements: 2, 3, 5_

- [ ] 7. Tests pass, build green, demo reset path works
  - `npm test` and `npm run build` both pass; reset returns the store to a
    fresh-seed baseline.
  - _Requirements: all_

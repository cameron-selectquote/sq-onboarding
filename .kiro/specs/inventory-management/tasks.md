# Tasks — Inventory management (software-seat pools)

> The seat-pool foundation (`seats.ts`, capacity-checked `assign`, IT queue UI,
> `GET /api/catalog` pools) is already built and green on this branch — see
> design.md "What's already built". These tasks finish it. Each should leave the
> build green (`npm test` + `npm run build`).

- [x] 1. Add explicit `requested` license status
  - Add `requested` to `LicenseStatus` in `src/lib/types.ts`; mirror it in
    `schema.sql`'s `license.status` constraint. Announce the contract change.
  - Confirm `assignedSeats` (`src/lib/seats.ts`) still excludes it — `requested`
    must NOT be in `CONSUMING_STATUSES`.
  - _Requirements: 2, 9 — contract impact_

- [x] 2. Migrate the "waiting seat" convention off `revoked`+`null`
  - `src/lib/templates.ts`: deferred overflow license → `status: "requested"`
    (keep `grantedAt: null`).
  - `src/data/seed.ts`: the three waiting seats (`lic_9`, `lic_10`, `lic_11`) →
    `status: "requested"`; update the explanatory comment.
  - `src/app/team/[team]/page.tsx`: "Seats waiting" filter → `l.status ===
"requested"` (drop the `grantedAt === null` test).
  - Update tests that assert the old value: `tests/templates.test.ts`
    (deferred license is now `"requested"`), and any seed/queue assertions.
  - _Requirements: 5, 6, 10_

- [x] 3. Enforce pool capacity in `grant()` too, not just `assign()`
  - In `src/lib/licenses.ts` extract `ensureSeatAvailable(appId)` (app lookup +
    `assignedSeats >= seatsOwned` → throw `NoSeatsAvailableError`). Call it from
    both `assign()` and `grant()`, before writing the ledger entry.
  - The grant route (`src/app/api/licenses/[id]/grant/route.ts`) maps
    `code === "no_seats_available"` to HTTP `409`; a full-pool grant leaves the
    license `requested` and writes no ledger entry.
  - Add a `tests/licenses.test.ts` case: granting a `requested` seat into a
    now-full pool throws, writes no ledger entry, status stays `requested`.
  - _Requirements: 7, 8_

- [x] 4. Verify reclaim/finance ignore `requested`
  - Check `src/lib/reclaim.ts` and `src/lib/finance.ts` don't count `requested`
    as spend or reclaimable (they read `active`/`idle`/`reclaim`). Add a guard
    only if a path counts it. No behavior change expected — this is a
    confirmation task with a quick assertion if needed.
  - _Requirements: 9_

- [x] 5. Route-level capacity tests
  - New test (e.g. `tests/seat-capacity.test.ts`) driving the handlers against a
    seeded store with `sequentialIdGenerator`/`fixedClock`:
    - `PATCH /api/tasks/:id` → `in_progress` on a full pool: task `blocked`,
      HTTP `409`, no active license, no ledger entry.
    - `POST /api/licenses` on a full pool: HTTP `409`, no license created.
    - `POST /api/licenses/:id/grant` on a full pool: HTTP `409`, license stays
      `requested`.
  - _Requirements: 3, 4, 8_

- [x] 6. Seed shows the capacity story on load
  - Confirm (or adjust seed) that a fresh load has at least one fully-allocated
    pool (available 0 — GitHub/Figma are already set up this way) and at least
    one `requested` seat in the IT queue. Add/extend the `seed.test.ts`
    assertion.
  - _Requirements: 10_

- [x] 7. Green bar + demo path
  - `npm test` + `npm run build` pass (clear `.next/types` first if a stale
    phantom-route typecheck error appears). Walk the capacity beat: full pool →
    task blocks → seat waits in IT queue → grant frees burn. Confirm the
    never-cut chain still lands.
  - _Requirements: 1–10_

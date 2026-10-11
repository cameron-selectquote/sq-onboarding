# Design — Inventory management (software-seat pools)

> Records the seat-pool foundation already on `feat/inventory-management`, then
> specifies the two changes that make it clean and safe: an explicit `requested`
> status, and a capacity guard that also covers `grant()`. No new services — the
> work extends `seats.ts`, `licenses.ts`, `templates.ts`, and the IT queue.

## What's already built (branch baseline)

These are done and tested; the remaining tasks build on them, don't redo them.

- **`src/lib/seats.ts`** — pure derivations:
  - `assignedSeats(app, licenses)` = `app.seatsInUseBaseline` + count of this
    app's licenses whose status is in `CONSUMING_STATUSES` (`active`, `idle`,
    `reclaim`).
  - `seatPools(apps, licenses)` → `{ appId, name, owned, assigned, available,
    monthlyCost }[]`, `available = max(owned − assigned, 0)`.
- **`src/lib/types.ts`** — `AppCatalogItem` has `seatsOwned` +
  `seatsInUseBaseline`.
- **`src/lib/licenses.ts`** — `assign(hireId, appId)` creates an active license
  + recurring ledger entry, guarded by a capacity check that throws
  `NoSeatsAvailableError` (carries a stable `code: "no_seats_available"` so
  routes identify it without `instanceof`, which is unreliable across Next.js
  bundle boundaries).
- **Routes** — `POST /api/licenses` (`409` when full), `PATCH /api/tasks/:id`
  (full pool → task `blocked`, `409`), `GET /api/catalog` returns `pools`.
- **`src/server/queries.ts`** — `getSeatPools()` returns owned pools, least-
  utilized first.
- **UI** — team queue (`src/app/team/[team]/page.tsx`) renders, for `it`: an
  "Assign an extra seat" form, a "Seat pools" panel (`assigned/owned`), and a
  "Seats waiting" queue.

## The problem the remaining work fixes

A requested-but-not-granted seat is currently stored as
`status: "revoked", grantedAt: null`. The "Seats waiting" queue, the import
deferral, and the seed all key off that exact pair. Two consequences:

- `revoked` means two different things (cancelled vs. waiting), so reading any
  one of those sites in isolation is misleading.
- `assignedSeats` excludes `revoked`, which is correct for *waiting* (don't hold
  a seat you haven't been granted) but accidental — a genuinely revoked seat and
  a waiting seat are indistinguishable, so the queue filter has to also test
  `grantedAt === null`.

And the capacity guard is only in `assign()`. `grant()` (used by the "Seats
waiting" queue and `POST /api/licenses/:id/grant`) writes the ledger with no
pool check, so a seat requested while there was room can be granted after the
pool filled, over-allocating.

## Approach

### 1. Explicit `requested` status

Add `requested` to `LicenseStatus`. Semantics:

- `requested` — the seat has been asked for but not granted; holds **no** seat
  (not in `CONSUMING_STATUSES`), carries **no** ledger spend, lives in IT's
  "Seats waiting" queue until granted.
- `revoked` — cancelled/returned; holds no seat; the credit already hit the
  ledger at revoke time.

`assignedSeats` stays as-is (neither `requested` nor `revoked` consumes a seat),
so the capacity math is unchanged — this is purely a readability + correctness
rename of the "waiting" state.

Migrate the three dependents off the magic pair:

- `templates.ts` — deferred overflow licenses get `status: "requested"`
  (instead of `"revoked"`) and keep `grantedAt: null`.
- `seed.ts` — the three seeded waiting seats (`lic_9`, `lic_10`, `lic_11`)
  become `status: "requested"`.
- team queue page — the "Seats waiting" filter becomes
  `l.status === "requested"` (drop the `grantedAt === null` test).

### 2. Capacity guard in `grant()`

Extract the capacity check into a small shared helper and call it from both
`assign()` and `grant()`:

```ts
// src/lib/licenses.ts
private async ensureSeatAvailable(appId: string): Promise<AppCatalogItem> {
  const app = await this.repo.appCatalog.get(appId);
  if (!app) throw new Error(`App "${appId}" not found`);
  const licenses = await this.repo.licenses.list();
  if (assignedSeats(app, licenses) >= app.seatsOwned) {
    throw new NoSeatsAvailableError(app.name);
  }
  return app;
}
```

`grant()` calls it before writing the ledger entry. Because the license being
granted is `requested` (not consuming), it isn't double-counted against the
pool — the check reflects true remaining capacity. On a full pool `grant()`
throws `NoSeatsAvailableError`; the grant route maps the stable
`code === "no_seats_available"` to `409` and leaves the license `requested`.

### 3. Route-level tests

The pure/service layer is covered. Add route coverage for the capacity
transitions that drive the demo:

- `PATCH /api/tasks/:id` → `in_progress` on a full pool returns `409` and the
  task is `blocked`.
- `POST /api/licenses` on a full pool returns `409`, no license created.
- `POST /api/licenses/:id/grant` on a full pool returns `409`, license stays
  `requested`.

## Where it lives

- `src/lib/types.ts` — add `requested` to `LicenseStatus`.
- `schema.sql` — mirror the new status in the `license.status` CHECK/enum.
- `src/lib/licenses.ts` — add `ensureSeatAvailable`, call it from `assign` and
  `grant`.
- `src/lib/templates.ts` — deferred license `status: "requested"`.
- `src/data/seed.ts` — waiting seats `status: "requested"`; comment updated.
- `src/app/team/[team]/page.tsx` — filter `status === "requested"`.
- `src/lib/reclaim.ts` / `finance.ts` — **verify** `requested` is not treated as
  spend or reclaimable (it shouldn't be, since those read `active`/`idle`/
  `reclaim`); add a guard only if a path counts it.
- `tests/` — update `templates.test.ts`, `seats.test.ts`, `licenses.test.ts`,
  `seed.test.ts` for the new status; add route tests (new file, e.g.
  `tests/seat-capacity.test.ts`, exercising the route handlers directly).

## Data / contract

- **`LicenseStatus` gains `requested`.** This is a contract event — announce it.
  Existing rows using `revoked`+`null` for "waiting" are migrated in the seed;
  no runtime data migration needed (in-memory + seeded SQLite are rebuilt).
- `schema.sql` must list `requested` so the Postgres/Supabase drop-in stays
  valid.
- Ledger conventions unchanged. A `requested` seat has written nothing; granting
  it writes exactly one recurring entry (as today), revoking later credits it.

## Testing strategy

- **Status semantics:** extend `seats.test.ts` to assert `requested` does **not**
  consume a seat (alongside the existing `revoked` case).
- **Template deferral:** update `templates.test.ts` so the deferred license
  asserts `status === "requested"` (was `"revoked"`), `grantedAt` null.
- **Grant guard:** add a `licenses.test.ts` case — a `requested` seat in a
  now-full pool fails `grant()` with `/No .* seats available/`, writes no ledger
  entry, leaves status `requested`.
- **Seed:** `seed.test.ts` asserts at least one pool is fully allocated
  (available 0) and at least one `requested` license exists.
- **Routes:** new test invokes the `PATCH /api/tasks/:id`, `POST /api/licenses`,
  and grant route handlers against a seeded `MemoryRepository`-backed store,
  asserting the `409` + non-mutation behavior (AC 3, 4, 8). Use
  `sequentialIdGenerator`/`fixedClock` for determinism.
- Green bar before handoff: `npm test` + `npm run build`.

## Risks / cut line

- **Contract change blast radius.** Adding `requested` touches a shared union.
  Mitigation: `assignedSeats` semantics don't change, so pool math and burn are
  unaffected; the migration is mechanical and covered by existing tests.
- **Double-count on grant.** If `grant()` ever counts the license it's granting
  against the pool, a requested seat would block itself. Mitigation: `requested`
  is non-consuming, so the guard sees true free capacity. Covered by the grant
  guard test.
- **Cut line:** if time-short, ship the `requested` status + the three
  dependents (items 1–2 below) and the grant guard (item 3); the route tests
  (item 4) are the first thing to drop since the service layer is already
  guarded.

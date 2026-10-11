# Requirements — Inventory management (software-seat pools)

> The `feat/inventory-management` branch added software-license **capacity** to
> the onboarding flow: every app now has a pool of owned seats, grants are
> checked against it, and overflow is deferred to an IT "Seats waiting" queue.
> The foundation is built and green (`src/lib/seats.ts`, capacity-checked
> `assign`, the IT queue UI, 131 passing tests). This spec records that work and
> closes the gaps it left so another dev can finish it cleanly.

## Problem / goal

"Inventory" here is **license capacity**, not hardware stock. Before this work,
granting a seat always succeeded and spent money with no notion of how many
seats the company actually owns, so the demo could over-allocate silently. The
branch introduced a seat pool per app (owned / assigned / available), a capacity
guard on grant/assign, and a deferral path so a full pool parks the request in
IT's queue instead of over-granting.

Two things are left:

1. The "requested but not granted" seat is currently **overloaded onto
   `status: "revoked"` with `grantedAt === null`** — the same status that means
   "genuinely cancelled." Three places (`templates.ts`, `seed.ts`, the team
   queue page) depend on that implicit convention. It works and is tested, but
   it couples unrelated code through a magic pair of field values.
2. The capacity guard lives in `assign()` only. **Granting a waiting seat
   (`grant()`) does not re-check the pool**, so IT can over-allocate a seat that
   was requested while the pool had room but granted after it filled up.
3. The capacity transitions are only tested at the pure-function and service
   level; the **route-level** behavior (task-start blocking, `409` responses)
   has no coverage.

The goal is a clear, explicit seat-request lifecycle and a capacity guard that
can't be bypassed, without breaking the never-cut demo chain
(import → tasks → grant → burn → reclaim).

## User stories

- As an **IT team member**, I want seats requested beyond the owned pool to show
  in a "Seats waiting" queue distinct from cancelled seats, so that I can grant
  them when capacity frees up without confusing them with revoked seats.
- As an **onboarding specialist**, I want starting a seat-granting task to be
  blocked when the app's pool is full, so that onboarding never silently
  over-allocates licenses.
- As a **finance** user, I want a requested-but-not-granted seat to carry no
  spend on the ledger until it is actually granted, so that live burn only
  reflects seats the company is really paying for.
- As the **other dev picking this up**, I want an explicit license status for
  "requested" instead of a `revoked`+`null` convention, so that the capacity
  code is readable and safe to change.

## Acceptance criteria

> EARS-style, testable. "Requested" below refers to the explicit status
> introduced by this spec (see design); it replaces the current
> `revoked`+`grantedAt === null` convention.

1. THE SYSTEM SHALL expose, per app the company owns seats for, an owned count,
   an assigned count, and an available count where `available = max(owned −
   assigned, 0)` (`GET /api/catalog` `pools`, and `getSeatPools`).
2. THE SYSTEM SHALL count a license as consuming a seat WHEN its status is
   `active`, `idle`, or `reclaim`, and SHALL NOT count it WHEN its status is
   `revoked` or `requested`.
3. WHEN a client assigns a seat (`POST /api/licenses`) AND the app's assigned
   count is at or above its owned count THE SYSTEM SHALL create no license, write
   no ledger entry, and return HTTP `409`.
4. WHEN a seat-granting task is started (`PATCH /api/tasks/:id` to
   `in_progress`) AND the app's pool is full THE SYSTEM SHALL set the task to
   `blocked`, create no active license, write no ledger entry, and return HTTP
   `409` identifying the full pool.
5. WHEN a hire is imported with more seats requested than the pool has room for
   THE SYSTEM SHALL grant what fits, create the overflow as `requested` licenses
   (no ledger entry), and report them in the import response `deferred` list.
6. THE SYSTEM SHALL list every `requested` license in IT's "Seats waiting" queue
   and SHALL NOT list `revoked` licenses there.
7. WHEN IT grants a `requested` seat (`POST /api/licenses/:id/grant`) AND the
   pool still has room THE SYSTEM SHALL set it `active`, write one recurring
   ledger entry, and bump the IT budget.
8. WHEN IT grants a `requested` seat AND the pool is now full THE SYSTEM SHALL
   leave the license `requested`, write no ledger entry, and return HTTP `409`.
9. WHILE a license is `requested` THE SYSTEM SHALL carry no spend for it on the
   ledger and SHALL NOT include it in live burn.
10. WHILE the seed dataset is loaded unmodified THE SYSTEM SHALL show at least
    one fully-allocated pool (available 0) and at least one `requested` seat in
    the IT queue, so the capacity story is visible on load.

## Out of scope

- **Hardware inventory / asset stock levels.** Assets have their own PO/return
  flow; this spec is software seats only. (A future "asset inventory" spec can
  mirror this shape.)
- **Buying more seats** (raising `seatsOwned` at runtime). The owned count is
  catalog seed data for now; a "buy seats" action is a later feature.
- **Realtime pool updates.** Refresh-on-action is fine (BuildPlan §6 cut line).
- **Right-sizing recommendations.** Surfacing under-utilized pools beyond the
  existing sort order is a finance-analytics concern, not this spec.

## Dependencies / contract impact

- **Contract change (coordinate with the team):** adding `requested` to
  `LicenseStatus` in `src/lib/types.ts` and mirroring it in `schema.sql`. This
  is the one type change; everything else uses existing fields.
- `AppCatalogItem.seatsOwned` and `seatsInUseBaseline` already exist on the
  branch — no further type change for pools.
- The `requested` migration touches `templates.ts`, `seed.ts`, the team queue
  page, and `getSeatPools`/`assignedSeats`. All already pass tests against the
  old convention, so the migration must keep them green.

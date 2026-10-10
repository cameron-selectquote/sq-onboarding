# Requirements — Reclaim visibility

> The reclaim rules (`src/lib/reclaim.ts`) are built and unit-tested but wired to
> nothing, and the seed has no reclaimable state to show. This spec closes both
> gaps so the money-shot beat has an endpoint and starts red.

## Problem / goal

"Reclaim banner goes green" is beat 5 of the demo and the one link in the
never-cut chain (`product.md`) with no backing endpoint. `flagLicenses` /
`flagAssets` exist and pass tests, but no route exposes them, so the frontend
can't render recoverable spend. On top of that, every seeded license is freshly
`active` and no hire is offboarding, so even a working banner would show nothing
to reclaim. We need a reclaim endpoint plus seed data that *starts* with
recoverable spend, so revoking a seat / returning an asset visibly moves the
number down and turns the banner green.

## User stories

- As a **finance** user, I want a single endpoint that lists every reclaimable
  license and asset with a dollar total, so that the reclaim banner shows real
  recoverable spend.
- As a **specialist**, I want the demo to open with licenses already flagged
  idle/duplicate and an asset pending return, so that acting on them is a
  visible before/after.
- As a **demo driver**, I want revoking a flagged seat to drop the reclaimable
  total, so that the banner going green is a real state change, not a mock.

## Acceptance criteria

> EARS-style, testable.

1. WHEN a client calls `GET /api/reclaim` THE SYSTEM SHALL return the list of
   license flags, the list of asset flags, and a numeric `reclaimableTotal` in
   monthly-normalized dollars.
2. WHEN a license is unused beyond the idle threshold THE SYSTEM SHALL include
   it in the license flags with reason `idle`.
3. WHEN a hire holds more than one active license in the same app category THE
   SYSTEM SHALL flag the extras with reason `duplicate`.
4. WHEN an asset is still `assigned` to an offboarding hire THE SYSTEM SHALL
   include it in the asset flags with reason `pending_return`.
5. WHILE the seed dataset is loaded unmodified THE SYSTEM SHALL report a
   `reclaimableTotal` greater than zero (the banner starts red).
6. WHEN a flagged seat is revoked via `POST /api/licenses/:id/revoke` THE SYSTEM
   SHALL report a strictly lower `reclaimableTotal` on the next
   `GET /api/reclaim`.
7. IF there is no recoverable spend THEN THE SYSTEM SHALL return empty flag lists
   and a `reclaimableTotal` of 0.

## Out of scope

- A reclaim *UI* — that's the Web Dev workstream; this spec delivers the
  endpoint and the seeded state it renders.
- `role_mismatch` wiring beyond what the seed naturally exercises — the rule
  exists in `reclaim.ts`; we don't need a role-allowlist config for the demo.
- Realtime push of the updated total — refresh-on-action is fine (BuildPlan §6
  cut line 1).

## Dependencies / contract impact

- No change to `src/lib/types.ts` or `schema.sql`. The reclaim scenario is
  expressed entirely with existing fields: `license.status`,
  `license.lastUsedAt`, `asset.status`, `asset.assignedToHireId`.
- Determining "offboarding" hires needs a signal. For the first pass we derive
  it in the seed/route without a new column (see design). If that later becomes
  a stored field, that's a contract event — flag the team then, not now.

# Tasks — Reclaim visibility

> Each task should leave the build green (`npm test` + `npm run build`).

- [x] 1. `buildReclaimReport` in `src/lib/reclaim.ts`
  - Pure assembler: run `flagLicenses` + `flagAssets`, compute
    `reclaimableTotal` (recurring monthly cost of flagged licenses, deduped by
    license id, + residual value of pending-return assets). Export
    `ReclaimReport`.
  - Export from `src/lib/index.ts`.
  - _Requirements: 1, 2, 3, 4, 7_

- [x] 2. Unit tests for `buildReclaimReport`
  - Idle + duplicate + pending-return scenario with injected `asOf`; assert flag
    kinds and the exact `reclaimableTotal`. Empty-input case → 0 + empty lists.
  - _Requirements: 1, 2, 3, 4, 7_

- [x] 3. Seed a reclaimable scenario in `src/data/seed.ts`
  - Add `gitlab` (category `dev`) to `appCatalog`. Give one hire an idle license
    (stale `lastUsedAt`) and a duplicate dev-category pair. Add an
    `offboarding`-cohort hire with an `assigned` asset.
  - _Requirements: 2, 3, 4, 5_

- [x] 4. `GET /api/reclaim` route
  - Thin handler: load licenses/apps/assets/assetCatalog/hires, derive
    offboarding ids from `cohort === "offboarding"`, call `buildReclaimReport`,
    return JSON. Under ~30 lines.
  - _Requirements: 1, 5_

- [x] 5. Seed assertion
  - Extend `tests/seed.test.ts`: loaded seed yields `reclaimableTotal > 0`.
  - _Requirements: 5_

- [x] 6. Revoke-drops-total check + build green
  - Confirm (test or manual) that revoking a flagged seat lowers the next
    report's total. `npm test` + `npm run build` pass; `GET /api/reclaim`
    returns a non-zero total on fresh seed.
  - _Requirements: 6_

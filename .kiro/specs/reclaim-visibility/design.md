# Design — Reclaim visibility

> Thin route over the existing pure `reclaim.ts` rules, plus a seed scenario
> that starts with recoverable spend. No new types, no contract change.

## Approach

The logic already exists and is tested: `flagLicenses` / `flagAssets` in
`src/lib/reclaim.ts`, and `reclaimable()` in `src/lib/finance.ts` for the dollar
total. The work is (a) a small `lib` assembler that runs the rules and sums the
money so the route stays thin, (b) the `GET /api/reclaim` route that calls it,
and (c) seeding a state that trips the rules on load.

The one wrinkle is "offboarding." `flagAssets` wants a set of offboarding hire
ids, but `Hire` has no `offboarding` column and we're not changing the contract.
We derive it from a **cohort convention**: hires whose `cohort` is
`"offboarding"` are treated as offboarding. The seed adds one such hire with an
assigned asset. This keeps the signal in existing data and is trivial to swap
for a real column later.

Idle detection depends on the clock. The route passes `asOf: new Date()` (real
wall clock) with the default 30-day threshold; the seed sets a stale
`lastUsedAt` far enough in the past that it stays idle regardless of demo date.

## Where it lives

- `src/lib/reclaim.ts` — add `buildReclaimReport(input)`: runs `flagLicenses` +
  `flagAssets`, computes `reclaimableTotal` via `finance.reclaimable`-style
  math, returns `{ licenseFlags, assetFlags, reclaimableTotal }`. Pure; takes
  `asOf` and the offboarding set as input.
- `src/app/api/reclaim/route.ts` — `GET`: pull licenses/apps/assets/hires from
  the repo, derive offboarding ids from cohort, call `buildReclaimReport`,
  return JSON. Under ~30 lines.
- `src/data/seed.ts` — add reclaimable state (see Data below).
- `tests/reclaim.test.ts` — add cases for `buildReclaimReport`.
- `tests/seed.test.ts` — assert the loaded seed yields `reclaimableTotal > 0`.

## Data / contract

No change to `src/lib/types.ts` or `schema.sql`. The scenario uses existing
fields only:

- **Idle license:** an existing active license gets a stale `lastUsedAt`
  (e.g. `2026-01-01`), well past the 30-day threshold.
- **Duplicate licenses:** give one hire two active licenses in the same
  `app_catalog.category` (e.g. `github` + a second `dev`-category app). Needs a
  second dev-category app in `appCatalog` — add `gitlab` (category `dev`) to the
  catalog. That's catalog seed data, not a type change.
- **Pending-return asset:** add a hire with `cohort: "offboarding"` and an
  `asset` row `status: "assigned"`, `assignedToHireId` = that hire.

Ledger stays untouched here — reclaim is a *read* of recoverable spend, not a
spend event. Positive/negative conventions are unaffected.

## Service / API surface

```ts
// src/lib/reclaim.ts
export interface ReclaimReport {
  licenseFlags: LicenseReclaimFlag[];
  assetFlags: AssetReclaimFlag[];
  reclaimableTotal: number; // monthly-normalized dollars, >= 0
}

export function buildReclaimReport(input: {
  licenses: License[];
  apps: AppCatalogItem[];
  assets: Asset[];
  assetCatalog: AssetCatalogItem[];
  offboardingHireIds: ReadonlySet<string>;
  asOf?: Date;
  idleDays?: number;
}): ReclaimReport;
```

`GET /api/reclaim` →
`{ licenseFlags: [...], assetFlags: [...], reclaimableTotal: number }`

The total: recurring monthly cost of each flagged-license's app (deduped by
license id so a license flagged for two reasons isn't double-counted) plus the
residual value of each pending-return asset.

## Testing strategy

- Unit-test `buildReclaimReport` with a `fixedClock`-style `asOf` and
  hand-built records: an idle license, a duplicate pair, and a pending-return
  asset → assert the flag kinds and that `reclaimableTotal` equals the expected
  sum. Add an empty-input case → total 0, empty lists (AC 7).
- Extend `seed.test.ts`: load the seed into a `MemoryRepository`, build the
  report with the offboarding-cohort set, assert `reclaimableTotal > 0` (AC 5).
- Determinism via injected `asOf`; the stale `lastUsedAt` keeps idle stable.

## Risks / cut line

- **Dedup math:** a license flagged both idle *and* duplicate must count once.
  Mitigated by summing over unique license ids in `buildReclaimReport`.
- **Cohort convention is a stand-in** for a real offboarding flag. Low risk for
  the demo; documented so it isn't mistaken for the final contract.
- **Cut line:** if time-short, the route can skip the dollar total and return
  flags only — the banner can sum client-side. Keep the flags; they're the beat.

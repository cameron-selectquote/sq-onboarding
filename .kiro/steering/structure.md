# Structure — where things live & how to add

```
sq-onboarding/
├── schema.sql                 # target Postgres DDL (the §2 data-model contract)
├── BuildPlan.md               # feature brief, timeline, cut lines
├── src/
│   ├── lib/                   # DOMAIN CORE — pure/testable, no framework
│   │   ├── types.ts           # the shared contract: every table shape
│   │   ├── repository.ts      # Repository + Collection interfaces (the DB seam)
│   │   ├── memory-repository.ts  # in-memory implementation (first pass)
│   │   ├── ids.ts             # IdGenerator + Clock (inject for determinism)
│   │   ├── ledger.ts          # LedgerService — single source of truth for spend
│   │   ├── finance.ts         # pure derivations: burn, cost-per-hire, reclaimable
│   │   ├── reclaim.ts         # pure reclaim rules (idle/duplicate/mismatch)
│   │   ├── licenses.ts        # grant/revoke transitions (uses ledger)
│   │   ├── assets.ts          # PO + return transitions (uses ledger)
│   │   ├── templates.ts       # instantiate tasks+licenses for a hire
│   │   ├── ai.ts              # AiClient seam + MockAiClient
│   │   └── index.ts           # barrel — import from "@/lib"
│   ├── data/
│   │   └── seed.ts            # seed dataset + loadSeed(repo)
│   ├── server/
│   │   └── store.ts           # shared seeded repo + services for API routes
│   └── app/
│       ├── layout.tsx         # root layout
│       ├── page.tsx           # placeholder landing (lists live endpoints)
│       └── api/               # REST routes — THIN, delegate to lib services
│           ├── hires/ ...     # import, list, detail
│           ├── tasks/[id]/    # PATCH status
│           ├── licenses/[id]/ # grant, revoke
│           ├── pos/           # raise PO
│           ├── assets/ ...    # list, return
│           ├── finance/summary/
│           └── ai/match-template/
└── tests/                     # jest unit tests, one file per lib module
```

## The layering rule

```
app/api  →  src/lib services  →  Repository interface  →  MemoryRepository
                   ↑
            pure helpers (finance.ts, reclaim.ts)
```

Dependencies point inward. UI and routes depend on `lib`; `lib` depends on the
`Repository` interface, never on a concrete DB or on Next.js.

## How to add things (recipes)

**A new API endpoint**
1. Add/extend a service in `src/lib` with the logic + a unit test in `tests/`.
2. Create `src/app/api/<resource>/route.ts` (or `[id]/route.ts`). Parse input,
   call `getServices()`, call the service, return `NextResponse.json(...)`.
3. Keep the handler under ~30 lines. If it grows logic, push it into `lib`.

**A new field or table**
1. Update the type in `src/lib/types.ts` (the contract — tell the team).
2. Mirror it in `schema.sql`.
3. Add it to `MemoryRepository` if it's a new collection, and to `seed.ts`.

**A new role view (Web Dev workstream)**
- Build under `src/app/<role>/`. Fetch from the existing `/api` routes. Reuse
  the design language from the mockups referenced in `BuildPlan.md`.

**Swapping in Supabase (DevOps workstream)**
- Implement `Repository` as `SupabaseRepository`, run `schema.sql`, and change
  only `src/server/store.ts` to build it. No `lib/` or route changes.

## Testing conventions

- One test file per lib module, in `tests/`, named `<module>.test.ts`.
- Use `sequentialIdGenerator` and `fixedClock` from `@/lib/ids` for determinism.
- Test behavior and invariants (ledger stays in sync, status transitions),
  not implementation details.
- Run `npm test` before pushing. Coverage targets `src/lib/**`.

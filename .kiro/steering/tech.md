# Tech — stack & commands

## Stack

- **Next.js 15 (App Router)** — one repo, UI + API routes. No separate backend.
- **TypeScript**, strict mode. `noUncheckedIndexedAccess` is on — index access
  returns `T | undefined`, handle it.
- **React 19**.
- **Jest + ts-jest** for unit tests (`testEnvironment: node`).
- **Persistence: in-memory for now.** A `Repository` interface
  (`src/lib/repository.ts`) with a `MemoryRepository` implementation. Postgres /
  Supabase drops in later behind the same interface — see `schema.sql` for the
  target DDL.
- **AI**: a single `AiClient` seam (`src/lib/ai.ts`) with a `MockAiClient`. The
  event's hosted inference endpoint gets wired as a second implementation.

## Commands

```bash
npm install          # once
npm run dev          # dev server at http://localhost:3000
npm run build        # production build (also typechecks routes)
npm run typecheck    # tsc --noEmit
npm test             # jest, all unit tests
npm run test:watch   # jest in watch mode
npm run test:coverage
```

## Path alias

`@/*` maps to `src/*`. Import domain code as `@/lib`, seed as `@/data/seed`.

## Non-negotiables for a 24h build

- **Keep API routes thin.** A route parses input, calls a `lib/` service,
  returns JSON. No business logic in route handlers.
- **All spend goes through `LedgerService`.** Never write a `ledger_entry` or
  mutate `budget.spent` by hand — the service keeps them in sync.
- **Pure logic stays pure.** `finance.ts` and `reclaim.ts` are pure functions
  over plain records: no DB, no clock, no network. That's what keeps them
  unit-testable and fast to reason about.
- **Inject ids and clocks.** Services take an `IdGenerator` and `Clock` (see
  `src/lib/ids.ts`) so tests are deterministic. Don't call `Date.now()` or
  `crypto.randomUUID()` inside domain logic.
- **Don't block on infra.** If something needs Supabase or the AI endpoint,
  stub it behind the existing interface and keep moving.

## Windows / PowerShell note

Dev shell is PowerShell. Chain commands with `;`, not `&&`. Don't start the dev
server from an automated step — run `npm run dev` yourself in a terminal.

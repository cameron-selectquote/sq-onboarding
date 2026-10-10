# Provision

Onboarding + spend-control app for **Hack Midwest 2026** (Flex "Best FinTech
App"). Import a hire, auto-generate their onboarding tasks, grant software seats
and provision hardware, and watch every dollar move through a single live
ledger.

> Every seat granted, laptop shipped, and license reclaimed shows up as money on
> a live ledger — so finance sees cost-per-hire and recoverable spend as
> onboarding happens, not a quarter later.

This repo is the **first-pass framework** for the team to build on. The domain
core, API routes, seed data, and unit tests are in place; persistence is
in-memory behind a swappable interface so nobody is blocked on infra.

## Prerequisites

- **Node.js 20+**
- **npm 10+**

### npm registry (SelectQuote CodeArtifact)

Dependencies install from SelectQuote's AWS CodeArtifact registry, which needs a
short-lived token (good for ~12h). If `npm install` fails with `E401`, refresh it:

```powershell
aws sso login --profile prod
aws codeartifact login --tool npm --domain selectquote --domain-owner 586672212047 --repository selectquote-npm --region us-west-2 --profile prod
```

The `prod` profile is the one with CodeArtifact access (account `586672212047`).
Re-run both commands roughly once a day when the token expires.

## Quick start

```bash
npm install        # install dependencies (once)
npm run dev        # start the dev server
```

Open http://localhost:3000 — the landing page lists the live API endpoints.
Data is seeded automatically in-memory on first request.

## Common commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at `localhost:3000` (hot reload) |
| `npm run build` | Production build — also typechecks the API routes |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run all Jest unit tests |
| `npm run test:watch` | Jest in watch mode |
| `npm run test:coverage` | Tests with coverage (targets `src/lib`) |

> On Windows PowerShell, chain commands with `;` not `&&`. Don't launch the dev
> server from a script — run `npm run dev` in your own terminal.

## Try the API

With `npm run dev` running:

```bash
# list seeded hires
curl http://localhost:3000/api/hires

# finance summary (monthly burn, projected annual run-rate, reclaimable,
# assets on hand, overspent teams)
curl http://localhost:3000/api/finance/summary

# AI template match
curl -X POST http://localhost:3000/api/ai/match-template `
  -H "Content-Type: application/json" `
  -d '{"title":"Senior Software Engineer"}'
```

Available endpoints: `POST /api/hires/import`, `GET /api/hires`,
`GET /api/hires/:id`, `PATCH /api/tasks/:id`, `POST /api/licenses/:id/grant`,
`POST /api/licenses/:id/revoke`, `POST /api/pos`, `GET /api/assets`,
`POST /api/assets/:id/return`, `GET /api/finance/summary`,
`POST /api/ai/match-template`.

## Project layout

```
src/lib/      domain core — pure, testable, no framework (types, ledger,
              finance, reclaim, licenses, assets, templates, ai, repository)
src/data/     seed dataset + loader
src/server/   shared seeded repository + services for API routes
src/app/      Next.js App Router: pages + /api route handlers
tests/        Jest unit tests, one file per lib module
schema.sql    target Postgres DDL (the data-model contract)
BuildPlan.md  feature brief, timeline, cut lines
.kiro/        team context framework — steering + specs (start here)
```

## For the team: where to start

1. Read **`.kiro/README.md`** — it explains the steering files and spec workflow.
2. Skim the steering under **`.kiro/steering/`** (`product`, `tech`,
   `structure`) — the shared ground rules.
3. Pick up a workstream. The role-views example spec is in
   **`.kiro/specs/role-views/`**; copy `.kiro/specs/_template/` for a new one.

### Key conventions

- **API routes stay thin** — parse input, call a `src/lib` service, return JSON.
- **All spend flows through `LedgerService`** — never hand-write a ledger entry
  or mutate a budget.
- **`finance.ts` and `reclaim.ts` are pure** — plain records in, numbers out.
- **Inject ids/clocks** (`src/lib/ids.ts`) so tests stay deterministic.
- **Run `npm test` and `npm run build` before pushing.**

## Status

First-pass build: domain core + 11 API routes + seed data + 49 passing unit
tests. Persistence is in-memory; `schema.sql` is the Postgres target DevOps
swaps in behind the `Repository` interface. AI is mocked behind an `AiClient`
seam ready for the event's inference endpoint.

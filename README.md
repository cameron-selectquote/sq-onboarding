# Provision

Onboarding + spend-control app for **Hack Midwest 2026** (Flex "Best FinTech
App"). Import a hire, auto-generate their onboarding tasks, grant software seats
and provision hardware, and watch every dollar move through a single live
ledger.

> Every seat granted, laptop shipped, and license reclaimed shows up as money on
> a live ledger — so finance sees cost-per-hire and recoverable spend as
> onboarding happens, not a quarter later.

This repo is the **first-pass framework** for the team to build on. The domain
core, API routes, seed data, and unit tests are in place; persistence is a local
SQLite file behind a swappable interface so nobody is blocked on infra.

## Prerequisites

- **Node.js 20+**
- **npm 10+**

### Native module (better-sqlite3)

`npm install` pulls in `better-sqlite3`, a native module. It installs a prebuilt
binary on common platforms (no action needed). On an unsupported platform it
compiles from source, which needs standard C++ build tools (e.g. Xcode CLT on
macOS, build-essential on Linux, or the VS Build Tools on Windows).

## Quick start

```bash
npm install        # install dependencies (once)
npm run dev        # start the dev server
```

Open http://localhost:3000 — the landing page lists the live API endpoints.

## Persistent store (first run)

Persistence is a local **SQLite** file. There's nothing to install or configure:

- On first run the app creates `data/provision.sqlite` (and the `data/`
  directory) automatically, then loads the seed dataset into it.
- The file is **not** checked in (`.gitignore` excludes `data/*.sqlite*`), so a
  fresh clone starts clean and seeds itself on first request.
- The file persists across restarts — data you create in a session is still
  there next time. Reseeding only happens when the store is empty, so a restart
  never collides on duplicate records.

To start over from a clean seed, delete the file and restart:

```bash
Remove-Item data/provision.sqlite*   # PowerShell
# rm -f data/provision.sqlite*       # bash
```

The location is configurable via the `PROVISION_DB_PATH` env var. Set it to
`:memory:` for an ephemeral store (handy for throwaway runs or tests):

```bash
$env:PROVISION_DB_PATH = ":memory:"; npm run dev   # PowerShell
```

## Common commands

| Command                 | What it does                                      |
| ----------------------- | ------------------------------------------------- |
| `npm run dev`           | Dev server at `localhost:3000` (hot reload)       |
| `npm run build`         | Production build — also typechecks the API routes |
| `npm start`             | Serve the production build                        |
| `npm run typecheck`     | `tsc --noEmit`                                    |
| `npm test`              | Run all Jest unit tests                           |
| `npm run test:watch`    | Jest in watch mode                                |
| `npm run test:coverage` | Tests with coverage (targets `src/lib`)           |

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

# live ledger feed (newest-first, hire-name enriched; optional ?limit=N)
curl http://localhost:3000/api/finance/ledger

# AI template match
curl -X POST http://localhost:3000/api/ai/match-template `
  -H "Content-Type: application/json" `
  -d '{"title":"Senior Software Engineer"}'
```

Available endpoints: `POST /api/hires/import`, `GET /api/hires`,
`GET /api/hires/:id`, `GET /api/hires/:id/checklist`, `PATCH /api/tasks/:id`,
`POST /api/licenses/:id/grant`, `POST /api/licenses/:id/revoke`, `POST /api/pos`,
`GET /api/assets`, `POST /api/assets/:id/return`, `GET /api/catalog`,
`GET /api/reclaim`, `GET /api/finance/summary`, `GET /api/finance/ledger`,
`GET /api/openapi`, `POST /api/ai/match-template`, `GET /api/genie`,
`POST /api/genie`.

### Resetting the seed data (dev only)

The store persists to a SQLite file, so a demo run leaves it dirty. To get back
to the first-boot baseline (red reclaim banner) without restarting the server:

```bash
curl -X POST http://localhost:3000/api/dev/reset
```

It wipes every table and reloads the committed seed, returning per-collection
row counts. **Dev-only:** the route refuses with `404` when
`NODE_ENV === 'production'`, so it can't touch real data — but it has no other
auth gate, so don't expose a non-production build to anything you care about.

## Onboarding Genie (Strands Agents)

The Onboarding Genie is an AI agent built on the
[Strands Agents SDK](https://strandsagents.com) (`@strands-agents/sdk`). It
guides HR/managers from a candidate name to a published 30-day onboarding plan.
Find it at **`/specialist/genie`**.

Two agent tools do the work (`src/server/genie.ts`):

- `searchCandidateRecords` — look up pre-hire candidate records by name.
- `createOnboardingPlan` — publish the plan: creates the hire, instantiates
  tasks + tool seats, and returns the onboarding-portal link.

**Model (Amazon Bedrock, Strands' default).** Set credentials to run the live
agent; without them it falls back to a built-in deterministic planner that walks
the same beats, so the demo and tests run offline. The chat badge shows which
engine is active.

```bash
# Quickest for local dev: a Bedrock API key
export AWS_BEARER_TOKEN_BEDROCK=...
# or standard AWS credentials / profile with Bedrock + Claude access
export AWS_PROFILE=my-profile
# optional: override the model id (defaults to Claude Sonnet)
export GENIE_MODEL_ID=global.anthropic.claude-sonnet-4-6
```

Enable model access in the Amazon Bedrock console first. Try it:

```bash
curl http://localhost:3000/api/genie            # greeting + active engine
curl -X POST http://localhost:3000/api/genie \
  -H "Content-Type: application/json" \
  -d '{"message":"Nora Alvarez"}'
```

## Project layout

```
src/lib/      domain core — pure, testable, no framework (types, ledger,
              finance, reclaim, licenses, assets, templates, ai, repository)
src/data/     seed dataset + loader
src/server/   shared SQLite-backed repository + services for API routes
data/         local SQLite store (created on first run, gitignored)
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

First-pass build: domain core + 16 API routes + seed data + 78 passing unit
tests. Persistence is a local SQLite file (`better-sqlite3`) behind the
`Repository` interface; `schema.sql` is the Postgres target DevOps swaps in
behind the same interface. AI is mocked behind an `AiClient` seam ready for the
event's inference endpoint.

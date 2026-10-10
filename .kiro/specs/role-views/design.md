# Design — Role views

## Approach

Each role gets a route segment under `src/app/`. Pages are mostly server
components that fetch from the existing `/api` routes; interactive bits (task
drag, grant/revoke buttons) are small client components that POST/PATCH and then
refresh. No new business logic in the UI — it all lives in `src/lib` already.

Role scoping for the first pass is a lightweight role selector (query param or a
simple context), not real auth. The important invariant is **the new-hire view
renders zero cost data** — enforce that by giving it a dedicated, cost-free data
fetch (hire + tasks only), never the finance summary.

## Where it lives

- `src/app/specialist/page.tsx` — board of hires + tasks; task status controls.
- `src/app/finance/page.tsx` — KPI cards from `GET /api/finance/summary`.
- `src/app/team/[team]/page.tsx` — queue filtered to `ownerTeam`.
- `src/app/manager/page.tsx` — per-hire progress.
- `src/app/myonboarding/page.tsx` — new-hire checklist, **no costs**.
- `src/app/_components/` — shared KPI card, task row, status badge.

## Data / contract

No type or schema changes. Consumes:
- `GET /api/hires`, `GET /api/hires/:id`
- `PATCH /api/tasks/:id`
- `POST /api/licenses/:id/grant` · `/revoke`
- `POST /api/pos`, `GET /api/assets`, `POST /api/assets/:id/return`
- `GET /api/finance/summary`

## Service / API surface

No new endpoints expected. If the manager view needs "progress %", compute it
client-side from a hire's tasks (done / total) rather than adding an endpoint.

## Testing strategy

- The money logic is already unit-tested in `tests/`. UI tests are optional for
  the hackathon; if added, prefer a single test asserting the new-hire page
  renders no `$`.
- Manual role pass (QA workstream): log in as each role, confirm scope.

## Risks / cut line

- New-hire cost leak is the highest-risk bug (AC #4). Guard it at the data layer.
- If time-short, cut Manager and My-onboarding last (BuildPlan §6 cut line 5);
  Finance + Specialist + Team carry the demo.

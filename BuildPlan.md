# Provision — Build Plan

**Hack Midwest 2026 · Flex "Best FinTech App" · Team of 5 · 24 hours**
Companion to `FeatureBrief.md`. The mockups in this repo (`index.html`, `specialist.html`, `manager.html`, `team.html`, `finance.html`, `myonboarding.html`, `setup.html`, `brief-preview.html`) are the visual spec — build to match them.

---

## 0. Guiding principles for a 24h build

1. **The demo is the product.** Every hour, ask "does this make the 5-beat demo better?" If not, defer it.
2. **Agree the data model in hour 1.** It's the contract that lets five people work in parallel without blocking each other.
3. **Vertical slice before breadth.** Get one hire → one task → one visible cost working end-to-end early. Then widen.
4. **Seed data is a feature.** Realistic sample data makes the demo land and unblocks the frontend before the backend is done.
5. **Mock the hard edges on purpose.** Sends, payments, and real provisioning are simulated (see cut lines). This is a decision, not a shortcut.

---

## 1. Architecture at a glance

```
Next.js (App Router) — one repo, frontend + API routes
   │
   ├── UI (React)  →  the 8 role views, matching the mockups
   ├── API routes  →  REST-ish endpoints per resource
   └── lib/        →  ledger logic, reclaim rules, AI calls
        │
   Postgres (Supabase or Neon)
        ├── auth + row-level role access
        └── realtime (for live burn / notifications — optional)

   AI: hosted inference endpoint (provided at event) via a single lib/ai.ts wrapper
```

- **One repo, one deploy.** Next.js API routes avoid a separate backend service — fewer moving parts in 24h.
- **Supabase** is the recommended pick: Postgres + auth + roles + realtime in one, minimal setup.
- **Spend is an internal ledger** — a `ledger_entry` table, not a payment processor.

---

## 2. Data model (the hour-1 contract)

Agree these shapes first. Everything else builds against them.

| Table | Key fields | Notes |
|---|---|---|
| `company` | id, name, size, industry | one row for the demo; drives guided-setup defaults |
| `user` | id, name, email, role, team, manager_id | role ∈ {admin, specialist, manager, team_member, hire}; team ∈ {hr, it, vendor, facilities, finance} |
| `app_catalog` | id, name, category, cost_per_seat, billing (monthly/annual) | the software catalog |
| `asset_catalog` | id, name, category, standard_cost, depreciation_months | the hardware catalog — *types* of issuable asset (MacBook Pro, monitor, badge, phone). Parallel to `app_catalog` |
| `asset` | id, catalog_id, serial_tag, status, assigned_to_hire_id, acquired_at, returned_at | an *individual unit* in inventory — physical analog of `license`. status ∈ {in_stock, assigned, in_repair, returned, retired} |
| `template` | id, role_name | e.g. "Software Engineer" |
| `template_task` | id, template_id, title, owner_team, cost, cost_type | cost_type ∈ {none, one_time, recurring} |
| `hire` | id, name, email, role_name, manager_id, start_date, cohort | the people being onboarded |
| `task` | id, hire_id, title, owner_team, status, cost, cost_type | status ∈ {todo, in_progress, review, blocked, done}; instantiated from template_task |
| `license` | id, hire_id, app_id, status, granted_at, last_used_at | status ∈ {active, idle, reclaim, revoked} |
| `budget` | id, team, period, limit, spent | per-department guardrails |
| `ledger_entry` | id, hire_id, type, label, amount, cost_type, ref_table, ref_id, created_at | the single source of truth for all spend; `ref_table`/`ref_id` link an entry back to the `license` or `asset` that caused it |
| `notification` | id, target_team, message, batch_id, read | drives the in-app inbox |

**How assets flow:** a vendor "order laptop" task raises a PO → creates a one-time `ledger_entry` → provisions an `asset` row (status `assigned`, linked to the hire). On offboarding, the asset is marked for return (status `returned`), the same way a license is marked `reclaim`. Hardware is capital that gets tracked, assigned, and recovered — the physical mirror of the seat-reclaim story.

**Derived (compute, don't store):**
- Cost per hire = sum of that hire's `ledger_entry` rows (software seats + hardware assets + fees)
- Recurring monthly burn = sum of active `license` seat costs
- Reclaimable = recurring from licenses where status ∈ {idle, reclaim, duplicate} **+** residual value of `asset` rows pending return on offboarding
- Budget burn-down = `budget.spent / budget.limit`
- Asset inventory on hand = count of `asset` rows where status = `in_stock` (what's available to assign without a new PO)

---

## 3. API surface (rough)

Keep it boring and RESTful. Suggested routes:

- `POST /api/hires/import` — bulk create hires from CSV/paste, auto-instantiate tasks + licenses from template
- `GET /api/hires` / `GET /api/hires/:id` — list / detail (feeds specialist, manager, my-onboarding)
- `PATCH /api/tasks/:id` — update status (board drag, team queue actions)
- `POST /api/licenses/:id/grant` — grant seat → write ledger_entry + bump budget.spent
- `POST /api/licenses/:id/revoke` — reclaim seat → mark revoked, drop recurring
- `POST /api/pos` — raise a purchase order → one-time ledger_entry against a budget → provision an `asset` (status `assigned`)
- `GET /api/assets` — inventory list + on-hand counts (feeds the vendor/facilities queue)
- `POST /api/assets/:id/return` — mark an asset returned on offboarding (hardware analog of license revoke)
- `GET /api/finance/summary` — cost-per-hire, burn, run-rate, reclaimable
- `GET /api/notifications?team=it` / `PATCH /api/notifications/:id/read`
- `POST /api/ai/match-template` — offer letter/title → suggested template + stack + cost
- `POST /api/ai/draft-brief` — hire's granted tools → welcome-brief blurbs

---

## 4. Who builds what (workstreams)

Mapped to the specialties in the Feature Brief. Each person owns a vertical where possible so interfaces are the only coordination points.

### Finance Software Engineer — "the fintech core" (the prize-winning piece)
- `ledger_entry` logic: every grant/PO/revoke writes a ledger row
- Cost-per-hire, recurring burn, projected run-rate calculations
- Budget model + burn-down + overspend flags
- `GET /api/finance/summary` and the PO endpoint
- Owns the **Finance view** correctness end-to-end

### Data Engineer / Web Dev — "data in + intelligence"
- CSV/paste **hire import** → instantiate tasks & licenses from template
- **Template, app catalog & asset catalog** tables + seed data
- **License registry** CRUD + grant/revoke status transitions
- **Asset inventory** CRUD + assign/return status transitions (hardware mirror of licenses)
- **Reclaim rules** (idle > N days, duplicate category, role mismatch; assets pending return on offboarding)
- **AI endpoints**: template matcher + brief drafter (thin wrapper over `lib/ai.ts`)

### DevOps / AWS Architect — "foundation + glue"
- Repo scaffold, Next.js app, CI, **deploy to a live URL** (demo must be hosted)
- **Supabase**: schema migration, seed script, **auth + role-based access**
- `lib/ai.ts` wrapper + wiring the event's inference endpoint/credentials
- Realtime channel for live burn/notifications (optional, nice-to-have)
- Owns "it runs on a real URL and nothing is localhost-only"

### Web Developer — "the role views"
- Build the 8 pages to match the mockups, wired to real APIs:
  - Specialist board + queues, Manager reports, Team queue, Finance dashboard, My-onboarding, Guided setup, Access brief
- Shared component kit (reuse `assets/provision.css` as the design language)
- Live-updating KPI numbers (port the behavior already prototyped in `assets/provision.js`)

### QA / Help Desk — "make it real + present it"
- Author the **seed dataset**: 1 company, ~5 teams, ~8 catalog apps, ~5 catalog asset types with a small on-hand inventory, 2-3 templates, 5 hires, budgets (this unblocks everyone early)
- **Role-based test passes**: log in as each persona, confirm each sees only their scope
- Owns the **demo script** and the live run (practice the 5 beats)
- Catch the "new-hire view must not show costs" kind of role-scoping bugs

---

## 5. Timeline (rebased — build starts 1:20pm Sat)

Event: Sat 9:30am kickoff → Sun ~9:30am submit · 7:00pm Sat project checkpoint.
**Planning ran long and finished ~1:20pm Sat.** The concept, feature brief, mockups, and data model are done. The timeline below starts the build clock from there — ~20 hours of build left, and we've lost the pre-lunch runway, so the vertical slice has to come together fast and the 7pm checkpoint is now only ~5.5h away.

### Phase 0 — ✅ DONE (through 1:20pm) — Concept & contract
- Concept, `FeatureBrief.md`, mockups, and the data model (§2) are decided. No more design debate — build to the brief and mockups as the spec.

### Phase 1 — Foundation + vertical slice (1:20pm–5:00pm) — the critical phase
- DevOps (first 45 min, blocks everyone): scaffold Next.js repo, Supabase project, auth, deploy a blank app to a live URL. Migrate `schema.sql`.
- QA (in parallel, immediately): load the seed dataset so the frontend has real data by ~3pm.
- Then the slice: import one hire → see their tasks → grant one seat → one ledger entry → one KPI moves. End to end, ugly but real.
  - Finance: ledger write + summary endpoint. Data Eng: import + grant. Web: specialist page + finance KPI. DevOps: keep deploy green.
- **Gate (by 5:00pm):** the vertical slice works on the live URL. If it doesn't, stop adding and fix this before the checkpoint.

### Phase 2 — Breadth, in parallel (5:00pm–7:00pm checkpoint)
- Widen fast: the core views (Specialist, Team, Finance), PO flow + asset provisioning, budgets, grant/revoke.
- Template-matcher AI endpoint online first — it's in beat 1.
- **7:00pm checkpoint:** dry-run the 5-beat demo on the live URL, however rough. What's broken here sets the night's priorities. Protect this hour.

### Phase 3 — Fill out + money-shot polish (7:00pm–1:00am)
- Remaining views (Manager, My-onboarding, Guided setup, Access brief) and notifications inbox.
- Make the demo beats flawless: live burn tick-up, PO burn-down, **reclaim banner going green**.
- AI brief-drafting + anomaly flag (anomaly is first to cut — see §6).

### Phase 4 — Harden & rehearse (1:00am–6:00am)
- **Feature freeze at 1:00am.** Bug-fix only. Reload the seed data clean.
- QA runs the full role-based pass + rehearses the pitch twice.

### Phase 5 — Buffer & submit (6:00am–9:30am)
- Nothing new. Final deploy, submission writeup, record a backup demo video in case live fails.

> **Reality check:** we're ~4h behind the ideal start. The buffer absorbs some of it, but the real protection is the §6 cut lines — if the 7pm checkpoint slice isn't solid, start cutting from the bottom immediately rather than hoping to catch up overnight.

---

## 6. Cut lines (if we're behind)

Drop from the bottom up — the demo survives all of these:

1. **Realtime** → poll or refresh on action instead of websockets.
2. **Guided setup wizard** → ship it as the static mockup; seed config directly in the DB.
3. **AI anomaly flagging** → keep the template matcher (beat 1); drop anomaly if time-short.
4. **Access brief send** → already simulated; if needed, show only the mockup page.
5. **Manager + my-onboarding views** → nice for persona completeness, but the Flex story lives in Team + Finance. Cut last.

**Never cut:** import → tasks → grant seat → live burn → PO burn-down → **reclaim**. That chain *is* the pitch.

---

## 7. Definition of done (for the demo)

- Runs on a **public URL**, not localhost.
- Can log in as **specialist, manager, team, finance, new hire** and each sees the right scope.
- The **5 demo beats** run start to finish without a reset.
- At least **one AI call is live** (template matcher).
- A **backup demo video** exists.

---

## 8. First three things to do when the clock starts

1. DevOps spins up repo + Supabase + a deployed blank app.
2. Everyone writes the data model (§2) into `schema.sql` together — 30 min, no code yet.
3. QA seeds realistic data so the frontend has something real to render by noon.

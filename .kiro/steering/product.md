# Product — Provision

Provision is an onboarding + spend-control app built for Hack Midwest 2026 (Flex
"Best FinTech App"). It turns hiring someone into a tracked, costed workflow:
import a hire, auto-generate their onboarding tasks, grant software seats and
provision hardware, and watch the money move through a single ledger in real
time.

## The one-sentence pitch

Every seat granted, laptop shipped, and license reclaimed shows up as money on a
live ledger — so finance sees cost-per-hire and recoverable spend as onboarding
happens, not a quarter later.

## The demo IS the product

We are judged on a 5-beat live demo. Every decision answers one question: does
this make the demo better? The never-cut chain is:

> import → tasks → grant seat → live burn → PO burn-down → **reclaim**

That chain is the pitch. Protect it over everything else.

## Who uses it (role scopes)

- **Specialist** — runs onboarding: the board, team queues.
- **Manager** — reports on their hires' progress.
- **Team member** (it / vendor / facilities / finance) — works their queue.
- **Finance** — the money view: cost-per-hire, burn, run-rate, reclaimable.
- **New hire** — their own onboarding checklist. **Must never see costs.**

Role scoping is a correctness feature, not a nicety. A new-hire view leaking
dollar amounts is a demo-killing bug.

## Core domain language (use these words)

- **Ledger** — the single source of truth for all spend. Positive = spend,
  negative = credit/recovery. Nothing spends money without a ledger entry.
- **Grant / revoke** — give or reclaim a software seat (a `license`).
- **PO / provision / return** — buy, assign, and recover hardware (an `asset`).
  Hardware is the physical mirror of the seat story.
- **Reclaim** — recoverable spend: idle/duplicate licenses + assets pending
  return. The "reclaim banner goes green" is the money shot.
- **Recurring vs one-time** — seats are recurring monthly burn; hardware and
  fees are one-time.

See `BuildPlan.md` at the repo root for the full feature brief, timeline, and
cut lines.

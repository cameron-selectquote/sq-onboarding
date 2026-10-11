# Reclaim agent — handoff note

**Owner:** (coworker)
**Status:** not started — the human-driven reclaim flow ships first; this is the agent layer on top.

## What already exists (don't rebuild)

The reclaim-as-tracked-job lifecycle is built and merged. A seat flagged by finance
becomes a `ReclaimTask` and moves `pending → done` (or `cancelled`). The one place
money actually moves is `ReclaimTaskService.complete()` in `src/lib/reclaim-tasks.ts`:
it flips the job to `done` and calls `LicenseService.revoke()`, which writes the one
crediting ledger entry (`-monthlyCost`, type `license_revoke`, recurring) and drops burn.

On the IT page (`/team/it`, Reclaim tab) a user clicks **Revoke**, which today calls
`complete()` directly — human-driven, synchronous, no agent.

## The seam you plug into

Replace the trigger, not the lifecycle. Instead of the Revoke button completing the
job inline, it hands off to a Strands agent that performs the revoke and then marks
the job complete. Concretely:

- The agent run is **synchronous**, matching the Genie (`src/server/genie.ts`): one
  request runs the agent, which calls a `revokeLicense` tool, and the response comes
  back done. Model A from the design discussion.
- **Per-job**, not per-batch: "Reclaim all" fans out one agent call per open job
  (mirrors how "Grant N seats" is N grants). The agent revokes one seat per run.
- The agent's `revokeLicense` tool should call the existing
  `ReclaimTaskService.complete(taskId)` — do **not** write a new revoke/ledger path.
  `complete()` stays the single ledger-credit point so burn math and the finance
  reconciliation stay intact.
- **Scripted fallback required.** Like the Genie, with no Bedrock creds the agent
  can't call a model. Provide a deterministic scripted path that does the same
  `complete()` so the demo and tests run offline. See `hasBedrockCreds()` and the
  `scripted()` fallback in `genie.ts` for the exact pattern to copy.

## The `reclaiming` state is reserved for you

`ReclaimTaskStatus` already includes `reclaiming`, and `ReclaimTaskService.start()`
already does `pending → reclaiming`. **These are intentionally unused by the current
UI** — left dormant so your agent work is purely additive, no schema or type change.

When you wire the agent, use `reclaiming` as the "agent is working" state:
`pending → reclaiming` (on handoff) → `reclaiming → done` (when the agent finishes
via `complete()`). The current `complete()` already accepts `reclaiming` as a valid
starting status, so no service change is needed for that transition.

## Open question deferred to you

Whether the agent leaves a visible trace of what it did (a result line on the job
and/or an "(agent)" note on the ledger label) vs. completing silently. If you add a
trace, keep the ledger **amount and type identical** to today's revoke — only the
human-readable `label` may change — so the finance numbers don't move.

## Invariants not to break

- `complete()` is the only ledger-credit point. open/start/cancel write nothing.
- Recurring `$/mo` and one-time `$` residual are never summed.
- `/finance/reclaim` recoverable total and the reclaim queue must stay reconciled
  (`tests/queries.test.ts` guards this). Don't touch `buildReclaimReport`.
- Don't touch `/specialist` or the existing `/api/licenses/:id/revoke` route.

# Design — <feature name>

> How you'll build it. Keep it proportional — enough that a teammate could pick
> it up, not a novel.

## Approach

> The shape of the solution in a paragraph. Which layer does the work (lib
> service? pure helper? route? view?).

## Where it lives

> Files you'll add or change, mapped to the structure in `structure.md`.

- `src/lib/<...>.ts` — <what>
- `src/app/api/<...>/route.ts` — <what>
- `tests/<...>.test.ts` — <what>

## Data / contract

> Any new or changed types (`src/lib/types.ts`) and their `schema.sql` mirror.
> Keep positive = spend, negative = credit if touching the ledger.

## Service / API surface

> New functions or endpoints, with input/output shapes.

## Testing strategy

> What unit tests cover the behavior. Use injected id/clock for determinism.

## Risks / cut line

> What could go wrong, and what you'd drop first if time-short (see BuildPlan §6).

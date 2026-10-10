# Requirements — <feature name>

> Copy this folder to `.kiro/specs/<your-feature>/` and fill it in. Delete these
> quote blocks as you go.

## Problem / goal

> One or two sentences: what are we building and why does it make the demo
> better? Tie it back to the never-cut chain in `product.md` if you can.

## User stories

- As a **<role>**, I want **<capability>**, so that **<benefit>**.

## Acceptance criteria

> Use EARS-style, testable statements. Keep them concrete enough to write a test
> or click through in the demo.

1. WHEN <trigger> THE SYSTEM SHALL <observable behavior>.
2. WHILE <state> THE SYSTEM SHALL <behavior>.
3. IF <condition> THEN THE SYSTEM SHALL <behavior>.

## Out of scope

> What this feature explicitly does NOT cover. Protects against scope creep in a
> 24h build.

## Dependencies / contract impact

> Does this touch `src/lib/types.ts` or `schema.sql`? If yes, that's a team
> coordination event — list the shapes that change.

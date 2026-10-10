# .kiro — team context framework

This folder is the shared brain for the Provision build. If you're using Kiro,
these files load automatically and give the agent (and you) consistent context
so five people can build in parallel without re-explaining the project every
time.

## What's here

### `steering/` — always-on context
Markdown files that Kiro includes in every interaction. Keep them short and
true; they're the project's ground rules.

- **`product.md`** — what we're building, the pitch, role scopes, domain words.
- **`tech.md`** — stack, commands, and the non-negotiables (thin routes, ledger
  is the source of truth, pure logic, inject ids/clocks).
- **`structure.md`** — where code lives, the layering rule, and copy-paste
  recipes for adding endpoints, fields, views, and swapping in Supabase.

How inclusion works:
- Default: a steering file is **always** included.
- `inclusion: fileMatch` + `fileMatchPattern: '...'` — only when a matching file
  is in context (handy for area-specific rules, e.g. only when editing `*.sql`).
- `inclusion: manual` — only when you reference it with `#` in chat.

To add a rule, drop a new `.md` in `steering/`. Keep each file focused.

### `specs/` — structured feature work
Each spec is a folder with three files that take a feature from idea to code:
`requirements.md` → `design.md` → `tasks.md`. Use a spec when a feature is big
enough that the team needs to agree on scope and break it into tasks.

See `specs/_template/` for the shape, and `specs/role-views/` for a worked
example (the 8 role views — the Web Dev workstream).

## Adding your ideas

The team has ideas to fold in. The clean way:

1. **Small change / clarification?** Edit the relevant steering file.
2. **New feature with real scope?** Copy `specs/_template/` to
   `specs/<your-feature>/` and fill in requirements → design → tasks.
3. **Changing the data contract (`src/lib/types.ts` / `schema.sql`)?** That's a
   coordination event — note it in your spec's design and flag the team.

Keep steering as the stable "how we work," and specs as the per-feature "what
we're building next."

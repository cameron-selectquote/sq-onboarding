# Requirements — Login + home dashboard + admin role picker

## Problem / goal

Replace the persona-card login with a plain username/password sign-in. Everyone
lands on one `/home` dashboard inside the shared sidebar shell. Admins can switch
the role they view as, so the demo can hop between views without signing out.

## Roles

| Role       | Views                                                                    |
| ---------- | ------------------------------------------------------------------------ |
| `admin`    | home, specialist (board, hires, candidates, Genie, brief), finance, IT / hardware / facilities queues, manager, my onboarding, API docs |
| `manager`  | home, manager report + drill-down                                        |
| `employee` | home, own onboarding checklist. No costs, no API.                        |

## User stories

- As a **user**, I sign in with a username and password and land on my home dashboard.
- As an **admin**, I pick a role (and, for employee, which hire) under my user
  icon and see exactly what that role sees.
- As an **employee**, I never see dollar amounts.

## Acceptance criteria

1. WHEN a signed-out user opens any page THE SYSTEM SHALL redirect to `/login`
   (preserving `next`); APIs return 401.
2. WHEN valid credentials are submitted THE SYSTEM SHALL set a signed session and
   redirect to `next` (if the role may open it) or `/home`.
3. IF the username or password is wrong THEN THE SYSTEM SHALL return to `/login`
   with one generic error (no hint which field was wrong).
4. WHEN a signed-in user opens `/` THE SYSTEM SHALL redirect to `/home`.
5. THE SYSTEM SHALL render the sidebar nav from the viewing role's views only.
6. WHILE the real role is `admin` THE SYSTEM SHALL show a role picker under the
   user icon; for non-admins the picker is absent and `POST /api/session/view-as`
   returns 403.
7. WHEN an admin switches role THE SYSTEM SHALL enforce page and API access by
   the viewing role (server-side), keep the real role so they can switch back,
   and redirect to `/home`.
8. WHEN an admin switches to `employee` THE SYSTEM SHALL require a valid hire id
   and scope `/myonboarding` and `/home` to that hire.
9. `/home` SHALL show: admin — hires, burn, reclaimable, blocked tasks, recent
   ledger; manager — their hires' progress (no costs); employee — checklist
   progress and next tasks (no costs).
10. In dev (no `DEMO_PASSWORD`), the login form SHALL prefill the admin username.

## Out of scope

- Real identity provider, user table, per-user passwords. Accounts live in code
  (`src/lib/accounts.ts`) and share `DEMO_PASSWORD`.
- Viewing as a specific manager (there is one seeded manager).

## Dependencies / contract impact

- No change to `src/lib/types.ts` or `schema.sql`.
- Session token shape changes (old cookies become invalid → users sign in again).
- `Persona` (7 values) is replaced by `AppRole` (3 values) in `src/lib/access.ts`.

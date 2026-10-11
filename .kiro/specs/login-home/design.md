# Design — Login + home dashboard + admin role picker

## Pure core (`src/lib`)

- `access.ts` — `AppRole = admin | manager | employee`, `View` (adds `home`,
  `api-docs`), `ACCESS`, `canOpenPath`, `canCallApi`, `canSwitchRole`, and
  `navFor(role)` (sectioned sidebar items). `homePathFor` is always `/home`.
- `accounts.ts` — demo accounts `{ username, name, role, hireId }`:
  `admin` (Avery Admin), `manager` (Morgan Manager), `employee` (Riley Chen,
  `hire_1`). `findAccount` is case-insensitive.
- `session.ts` — `Session { username, name, role, viewAs, hireId, exp }`.
  Verification enforces: `viewAs === role` unless `role === admin`;
  `hireId` is a string iff `viewAs === employee`.

## Server / routes

- `middleware.ts` — checks use `session.viewAs`. Public: `/login`,
  `/api/session`, `/api/session/logout`, `/api/session/view-as` (it does its own
  admin check, so an admin viewing as employee can still switch back), `/api/health`.
- `POST /api/session` — `username`, `password`, `next`.
- `POST /api/session/view-as` — `viewAs`, `hireId`. Requires real role admin.

## UI

- `Shell` becomes an async server component: reads the session, renders
  `navFor(viewAs)`, and a user block (avatar, name, viewing role). Admins get a
  `RolePicker` client component (role select + hire select shown for employee).
  Pages pass only `active`.
- `/home` — one page, three dashboards keyed by `viewAs`.

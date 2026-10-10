# Tasks — Role views

> Each task should leave the build green (`npm test` + `npm run build`).

- [ ] 1. Shared UI shell + components
  - Root nav with a role selector; `_components/` KpiCard, TaskRow, StatusBadge.
  - _Requirements: 5_

- [ ] 2. Finance dashboard
  - Fetch `GET /api/finance/summary`; render burn, total spend, reclaimable,
    assets-on-hand as KPI cards.
  - _Requirements: 1, 3_

- [ ] 3. Specialist board
  - List hires + their tasks; status control calls `PATCH /api/tasks/:id` and
    refreshes.
  - _Requirements: 2_

- [ ] 4. Team queue
  - `team/[team]` filters tasks by `ownerTeam`; grant/revoke + raise-PO actions.
  - _Requirements: 3_

- [ ] 5. New-hire checklist (cost-free)
  - Hire + tasks only; assert no cost/budget data is fetched or rendered.
  - _Requirements: 4_

- [ ] 6. Manager report
  - Per-hire progress (done/total) computed client-side.
  - _Requirements: (persona completeness; cut line 5)_

- [ ] 7. QA role pass + demo path
  - Walk each role; confirm scope. Walk the never-cut chain end to end.
  - _Requirements: 1-5_

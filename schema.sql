-- Provision — schema (BuildPlan §2, the hour-1 contract).
-- Postgres DDL mirroring src/lib/types.ts. DevOps runs this against Supabase.
-- Enums model the status/role unions from the type contract.

create type role            as enum ('admin', 'specialist', 'manager', 'team_member', 'hire');
create type team            as enum ('hr', 'it', 'vendor', 'facilities', 'finance');
create type billing         as enum ('monthly', 'annual');
create type cost_type       as enum ('none', 'one_time', 'recurring');
create type task_status     as enum ('todo', 'in_progress', 'review', 'blocked', 'done');
create type license_status  as enum ('requested', 'active', 'idle', 'reclaim', 'revoked');
create type asset_status    as enum ('in_stock', 'assigned', 'in_repair', 'returned', 'retired');
create type ledger_type     as enum ('license_grant', 'license_revoke', 'asset_purchase', 'asset_return', 'fee');
create type reclaim_status  as enum ('pending', 'reclaiming', 'done', 'cancelled');

create table company (
  id        text primary key,
  name      text not null,
  size      integer not null,
  industry  text not null
);

create table app_user (
  id          text primary key,
  name        text not null,
  email       text not null unique,
  role        role not null,
  team        team,
  manager_id  text references app_user(id)
);

create table app_catalog (
  id             text primary key,
  name           text not null,
  category       text not null,
  cost_per_seat  numeric(12,2) not null,
  billing        billing not null,
  seats_owned    integer not null default 0,
  seats_in_use_baseline integer not null default 0
);

create table asset_catalog (
  id                  text primary key,
  name                text not null,
  category            text not null,
  standard_cost       numeric(12,2) not null,
  depreciation_months integer not null
);

create table template (
  id         text primary key,
  role_name  text not null
);

create table template_task (
  id           text primary key,
  template_id  text not null references template(id) on delete cascade,
  title        text not null,
  owner_team   team not null,
  cost         numeric(12,2) not null default 0,
  cost_type    cost_type not null default 'none',
  app_id       text references app_catalog(id)
);

create table hire (
  id          text primary key,
  name        text not null,
  email       text not null,
  role_name   text not null,
  manager_id  text references app_user(id),
  start_date  date not null,
  cohort      text
);

create table asset (
  id                  text primary key,
  catalog_id          text not null references asset_catalog(id),
  serial_tag          text not null,
  status              asset_status not null default 'in_stock',
  assigned_to_hire_id text references hire(id),
  acquired_at         date,
  returned_at         date
);

create table task (
  id          text primary key,
  hire_id     text not null references hire(id) on delete cascade,
  title       text not null,
  owner_team  team not null,
  status      task_status not null default 'todo',
  cost        numeric(12,2) not null default 0,
  cost_type   cost_type not null default 'none',
  app_id      text references app_catalog(id)
);

create table license (
  id            text primary key,
  hire_id       text not null references hire(id) on delete cascade,
  app_id        text not null references app_catalog(id),
  status        license_status not null default 'active',
  granted_at    timestamptz,
  last_used_at  timestamptz
);

create table budget (
  id      text primary key,
  team    team not null,
  period  text not null,
  "limit" numeric(14,2) not null,
  spent   numeric(14,2) not null default 0
);

create table ledger_entry (
  id          text primary key,
  hire_id     text references hire(id) on delete set null,
  type        ledger_type not null,
  label       text not null,
  amount      numeric(14,2) not null,  -- positive = spend, negative = credit
  cost_type   cost_type not null,
  ref_table   text,
  ref_id      text,
  created_at  timestamptz not null default now()
);

create table notification (
  id           text primary key,
  target_team  team not null,
  message      text not null,
  batch_id     text,
  read         boolean not null default false
);

-- Pre-hire records the Onboarding Genie searches by name. Publishing a plan
-- flips status to 'onboarding' and links the created hire.
create table candidate (
  id                text primary key,
  name              text not null,
  title             text not null,
  role_name         text,
  hiring_manager_id text references app_user(id) on delete set null,
  resume_file       text,
  start_date        date,
  status            text not null default 'new',  -- new | onboarding
  hire_id           text references hire(id) on delete set null
);

-- A tracked reclaim job: finance flags a seat, IT executes it. The ledger
-- credit happens only on completion (via the revoke path); open/start/cancel
-- never write to the ledger.
create table reclaim_task (
  id              text primary key,
  license_id      text not null references license(id) on delete cascade,
  status          reclaim_status not null default 'pending',
  created_by_team team not null,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  cancelled_at    timestamptz
);

-- Hot paths for the finance/reclaim queries.
create index idx_ledger_hire   on ledger_entry(hire_id);
create index idx_license_hire  on license(hire_id);
create index idx_license_app   on license(app_id);
create index idx_task_hire     on task(hire_id);
create index idx_asset_hire    on asset(assigned_to_hire_id);
create index idx_candidate_name on candidate(lower(name));
create index idx_reclaim_task_license on reclaim_task(license_id);

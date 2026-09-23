-- Persistência da integração ClickDesk do Chat 2.0.
-- Homologação: guarda somente metadados necessários à performance.
-- Não armazena transcript, mensagens nem dados do cliente.

begin;

create table if not exists public.clickdesk_chat_analyst_links (
  id uuid primary key default gen_random_uuid(),
  assignee_key text not null unique,
  assignee_name text not null,
  analyst_id uuid not null references public.chat_analysts(id) on delete cascade,
  link_source text not null default 'auto_name_match'
    check (link_source in ('auto_name_match', 'manual')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clickdesk_chat_analyst_links_analyst_idx
  on public.clickdesk_chat_analyst_links (analyst_id);

create table if not exists public.clickdesk_chat_attendances (
  id uuid primary key default gen_random_uuid(),
  clickdesk_ticket_id text not null unique,
  attendance_mode text not null default 'human'
    check (attendance_mode = 'human'),
  occurred_at timestamptz not null,
  occurred_date date not null,
  area text not null,
  assignee_name text not null,
  assignee_key text not null,
  analyst_id uuid references public.chat_analysts(id) on delete set null,
  team_id uuid references public.chat_teams(id) on delete set null,
  satisfaction_label text,
  timestamp_source text not null default 'unknown',
  journey_status text not null default 'ai_to_human'
    check (journey_status = 'ai_to_human'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clickdesk_chat_attendances
  add column if not exists timestamp_source text not null default 'unknown';

create index if not exists clickdesk_chat_attendances_date_idx
  on public.clickdesk_chat_attendances (occurred_date desc);

create index if not exists clickdesk_chat_attendances_analyst_date_idx
  on public.clickdesk_chat_attendances (analyst_id, occurred_date desc);

create index if not exists clickdesk_chat_attendances_team_date_idx
  on public.clickdesk_chat_attendances (team_id, occurred_date desc);

create index if not exists clickdesk_chat_attendances_assignee_key_idx
  on public.clickdesk_chat_attendances (assignee_key);

create table if not exists public.clickdesk_chat_sync_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  trigger_mode text not null default 'manual'
    check (trigger_mode in ('manual', 'automatic')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  pages_scanned integer not null default 0,
  rows_received integer not null default 0,
  rows_in_period integer not null default 0,
  rows_target_scope integer not null default 0,
  rows_upserted integer not null default 0,
  matched_rows integer not null default 0,
  unmatched_rows integer not null default 0,
  unmatched_assignees jsonb not null default '[]'::jsonb,
  triggered_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists clickdesk_chat_sync_runs_period_idx
  on public.clickdesk_chat_sync_runs (period_start desc, period_end desc);

create index if not exists clickdesk_chat_sync_runs_triggered_by_idx
  on public.clickdesk_chat_sync_runs (triggered_by);

alter table public.clickdesk_chat_analyst_links enable row level security;
alter table public.clickdesk_chat_attendances enable row level security;
alter table public.clickdesk_chat_sync_runs enable row level security;

revoke all on public.clickdesk_chat_analyst_links from anon, authenticated;
revoke all on public.clickdesk_chat_attendances from anon, authenticated;
revoke all on public.clickdesk_chat_sync_runs from anon, authenticated;

grant select, insert, update, delete on public.clickdesk_chat_analyst_links to authenticated;
grant select on public.clickdesk_chat_attendances to authenticated;
grant select on public.clickdesk_chat_sync_runs to authenticated;

drop policy if exists "clickdesk_chat_links_management" on public.clickdesk_chat_analyst_links;
create policy "clickdesk_chat_links_management"
on public.clickdesk_chat_analyst_links
for all
to authenticated
using ((select public.is_management_user()))
with check ((select public.is_management_user()));

drop policy if exists "clickdesk_chat_attendances_management_select" on public.clickdesk_chat_attendances;
create policy "clickdesk_chat_attendances_management_select"
on public.clickdesk_chat_attendances
for select
to authenticated
using ((select public.is_management_user()));

drop policy if exists "clickdesk_chat_sync_runs_management_select" on public.clickdesk_chat_sync_runs;
create policy "clickdesk_chat_sync_runs_management_select"
on public.clickdesk_chat_sync_runs
for select
to authenticated
using ((select public.is_management_user()));

create or replace view public.clickdesk_chat_daily_metrics
with (security_invoker = true)
as
select
  occurred_date,
  team_id,
  analyst_id,
  area,
  assignee_name,
  count(*)::integer as attendances,
  count(*) filter (where lower(coalesce(satisfaction_label, '')) = 'positive')::integer as positive_reviews,
  count(*) filter (where lower(coalesce(satisfaction_label, '')) = 'negative')::integer as negative_reviews,
  count(*) filter (where lower(coalesce(satisfaction_label, '')) in ('positive', 'negative'))::integer as reviews,
  case
    when count(*) filter (where lower(coalesce(satisfaction_label, '')) in ('positive', 'negative')) > 0
      then round(
        (
          count(*) filter (where lower(coalesce(satisfaction_label, '')) = 'positive')::numeric
          /
          count(*) filter (where lower(coalesce(satisfaction_label, '')) in ('positive', 'negative'))::numeric
        ) * 100,
        2
      )
    else null
  end as csat,
  round(
    (
      count(*) filter (where lower(coalesce(satisfaction_label, '')) in ('positive', 'negative'))::numeric
      /
      nullif(count(*), 0)::numeric
    ) * 100,
    2
  ) as review_percentage
from public.clickdesk_chat_attendances
group by occurred_date, team_id, analyst_id, area, assignee_name;

revoke all on public.clickdesk_chat_daily_metrics from anon, authenticated;
grant select on public.clickdesk_chat_daily_metrics to authenticated;

commit;

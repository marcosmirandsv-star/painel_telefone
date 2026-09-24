-- Evolução da persistência ClickDesk: identidade por responsável + área.
-- Mantém equipe derivada da área e separa analista, gestão e identidade ainda não vinculada.

begin;

create table if not exists public.clickdesk_chat_area_links (
  area_key text primary key,
  area_name text not null,
  team_id uuid not null references public.chat_teams(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.clickdesk_chat_area_links (area_key, area_name, team_id)
values
  ('suporte erp', 'Suporte - ERP', 'dc039139-7bec-4271-a27a-38a32959a892'),
  ('suporte fiscal', 'Suporte - Fiscal', '6a9ad22d-7c6f-48e0-98bc-60561dcc8008')
on conflict (area_key) do update
set area_name = excluded.area_name,
    team_id = excluded.team_id,
    active = true,
    updated_at = now();

alter table public.clickdesk_chat_analyst_links
  add column if not exists area_key text,
  add column if not exists area_name text,
  add column if not exists team_id uuid references public.chat_teams(id) on delete set null,
  add column if not exists person_role text not null default 'analyst';

alter table public.clickdesk_chat_analyst_links
  alter column analyst_id drop not null;

alter table public.clickdesk_chat_analyst_links
  drop constraint if exists clickdesk_chat_analyst_links_assignee_key_key;

alter table public.clickdesk_chat_analyst_links
  drop constraint if exists clickdesk_chat_analyst_links_link_source_check;

alter table public.clickdesk_chat_analyst_links
  drop constraint if exists clickdesk_chat_analyst_links_person_role_check;

alter table public.clickdesk_chat_analyst_links
  add constraint clickdesk_chat_analyst_links_link_source_check
    check (link_source in ('auto_name_match', 'manual', 'manager_match', 'unmatched')),
  add constraint clickdesk_chat_analyst_links_person_role_check
    check (person_role in ('analyst', 'management', 'unmapped'));

update public.clickdesk_chat_analyst_links l
set area_key = case
      when a.team_id = 'dc039139-7bec-4271-a27a-38a32959a892' then 'suporte erp'
      when a.team_id = '6a9ad22d-7c6f-48e0-98bc-60561dcc8008' then 'suporte fiscal'
      else l.area_key
    end,
    area_name = case
      when a.team_id = 'dc039139-7bec-4271-a27a-38a32959a892' then 'Suporte - ERP'
      when a.team_id = '6a9ad22d-7c6f-48e0-98bc-60561dcc8008' then 'Suporte - Fiscal'
      else l.area_name
    end,
    team_id = coalesce(l.team_id, a.team_id),
    person_role = 'analyst'
from public.chat_analysts a
where l.analyst_id = a.id;

alter table public.clickdesk_chat_analyst_links
  alter column area_key set not null,
  alter column area_name set not null;

create unique index if not exists clickdesk_chat_analyst_links_identity_area_uidx
  on public.clickdesk_chat_analyst_links (assignee_key, area_key);

create index if not exists clickdesk_chat_analyst_links_team_idx
  on public.clickdesk_chat_analyst_links (team_id);

create index if not exists clickdesk_chat_analyst_links_area_idx
  on public.clickdesk_chat_analyst_links (area_key);

alter table public.clickdesk_chat_attendances
  add column if not exists identity_role text not null default 'unmapped';

alter table public.clickdesk_chat_attendances
  drop constraint if exists clickdesk_chat_attendances_identity_role_check;

alter table public.clickdesk_chat_attendances
  add constraint clickdesk_chat_attendances_identity_role_check
    check (identity_role in ('analyst', 'management', 'unmapped'));

update public.clickdesk_chat_attendances
set team_id = case
      when lower(area) like '%erp%' then 'dc039139-7bec-4271-a27a-38a32959a892'::uuid
      when lower(area) like '%fiscal%' then '6a9ad22d-7c6f-48e0-98bc-60561dcc8008'::uuid
      else team_id
    end,
    identity_role = case when analyst_id is not null then 'analyst' else identity_role end
where area is not null;

update public.clickdesk_chat_attendances a
set identity_role = 'management'
where a.analyst_id is null
  and exists (
    select 1
    from public.chat_teams t
    where t.manager_name is not null
      and lower(t.manager_name) = lower(a.assignee_name)
  );

create index if not exists clickdesk_chat_attendances_identity_role_idx
  on public.clickdesk_chat_attendances (identity_role);

alter table public.clickdesk_chat_sync_runs
  add column if not exists analyst_rows integer not null default 0,
  add column if not exists management_rows integer not null default 0,
  add column if not exists unmapped_rows integer not null default 0;

alter table public.clickdesk_chat_area_links enable row level security;

revoke all on public.clickdesk_chat_area_links from anon, authenticated;
grant select, insert, update, delete on public.clickdesk_chat_area_links to authenticated;

drop policy if exists "clickdesk_chat_area_links_management" on public.clickdesk_chat_area_links;
create policy "clickdesk_chat_area_links_management"
on public.clickdesk_chat_area_links
for all
to authenticated
using ((select public.is_management_user()))
with check ((select public.is_management_user()));

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
  ) as review_percentage,
  identity_role
from public.clickdesk_chat_attendances
group by occurred_date, team_id, analyst_id, area, assignee_name, identity_role;

revoke all on public.clickdesk_chat_daily_metrics from anon, authenticated;
grant select on public.clickdesk_chat_daily_metrics to authenticated;

commit;

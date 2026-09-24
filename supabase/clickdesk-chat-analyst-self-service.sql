-- Portal individual do Chat 2.0 / ClickDesk.
-- Separa o vínculo de analista do Telefone e do Chat e aplica RLS de autoatendimento.

begin;

alter table public.profiles
  add column if not exists chat_analyst_id uuid references public.chat_analysts(id) on delete set null;

create index if not exists profiles_chat_analyst_id_idx
  on public.profiles (chat_analyst_id);

create or replace function public.current_user_chat_analyst_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select chat_analyst_id
  from public.profiles
  where id = auth.uid()
$$;

create or replace function public.current_user_chat_team_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select ca.team_id
  from public.chat_analysts ca
  where ca.id = public.current_user_chat_analyst_id()
$$;

revoke all on function public.current_user_chat_analyst_id() from public, anon;
revoke all on function public.current_user_chat_team_id() from public, anon;
grant execute on function public.current_user_chat_analyst_id() to authenticated;
grant execute on function public.current_user_chat_team_id() to authenticated;

drop policy if exists "profiles_homologation_all" on public.profiles;
drop policy if exists "profiles_select_own_or_management" on public.profiles;
drop policy if exists "profiles_insert_management" on public.profiles;
drop policy if exists "profiles_update_management" on public.profiles;
drop policy if exists "profiles_delete_management" on public.profiles;

create policy "profiles_select_own_or_management"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_management_user())
);

create policy "profiles_insert_management"
on public.profiles
for insert
to authenticated
with check ((select public.is_management_user()));

create policy "profiles_update_management"
on public.profiles
for update
to authenticated
using ((select public.is_management_user()))
with check ((select public.is_management_user()));

create policy "profiles_delete_management"
on public.profiles
for delete
to authenticated
using ((select public.is_management_user()));

revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;

drop policy if exists "chat_analysts_select_authenticated" on public.chat_analysts;
drop policy if exists "chat_analysts_select_management_or_self" on public.chat_analysts;
create policy "chat_analysts_select_management_or_self"
on public.chat_analysts
for select
to authenticated
using (
  (select public.is_management_user())
  or id = (select public.current_user_chat_analyst_id())
);

drop policy if exists "chat_teams_select_authenticated" on public.chat_teams;
drop policy if exists "chat_teams_select_management_or_self" on public.chat_teams;
create policy "chat_teams_select_management_or_self"
on public.chat_teams
for select
to authenticated
using (
  (select public.is_management_user())
  or id = (select public.current_user_chat_team_id())
);

drop policy if exists "chat_monthly_metrics_select_authenticated" on public.chat_monthly_metrics;
drop policy if exists "chat_monthly_metrics_select_management_or_self" on public.chat_monthly_metrics;
create policy "chat_monthly_metrics_select_management_or_self"
on public.chat_monthly_metrics
for select
to authenticated
using (
  (select public.is_management_user())
  or analyst_id = (select public.current_user_chat_analyst_id())
);

drop policy if exists "chat_podium_manual_select_authenticated" on public.chat_podium_manual;
drop policy if exists "chat_podium_manual_select_management" on public.chat_podium_manual;
create policy "chat_podium_manual_select_management"
on public.chat_podium_manual
for select
to authenticated
using ((select public.is_management_user()));

drop policy if exists "chat_podium_exclusions_select_authenticated" on public.chat_podium_exclusions;
drop policy if exists "chat_podium_exclusions_select_management" on public.chat_podium_exclusions;
create policy "chat_podium_exclusions_select_management"
on public.chat_podium_exclusions
for select
to authenticated
using ((select public.is_management_user()));

drop policy if exists "clickdesk_chat_attendances_self_select" on public.clickdesk_chat_attendances;
create policy "clickdesk_chat_attendances_self_select"
on public.clickdesk_chat_attendances
for select
to authenticated
using (
  analyst_id is not null
  and analyst_id = (select public.current_user_chat_analyst_id())
);

create or replace function public.get_clickdesk_self_closed_history()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with own as (
    select public.current_user_chat_analyst_id() as analyst_id
  ),
  candidates as (
    select
      c.month,
      c.id as closure_id,
      c.created_at as closed_at,
      c.team,
      a.item as analyst
    from public.integration_closures c
    cross join own
    cross join lateral jsonb_array_elements(coalesce(c.payload->'analistas', '[]'::jsonb)) a(item)
    where own.analyst_id is not null
      and c.channel = 'chat'
      and c.payload->>'fonte' = 'clickdesk_persisted'
      and c.payload->>'regras' = 'clickdesk-human-v1'
      and a.item->>'analyst_id' = own.analyst_id::text
  ),
  preferred as (
    select distinct on (month)
      month,
      closure_id,
      closed_at,
      analyst
    from candidates
    order by month, (team = 'all') desc, closed_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', month,
        'closure_id', closure_id,
        'closed_at', closed_at,
        'analyst', analyst
      )
      order by month
    ),
    '[]'::jsonb
  )
  from preferred
$$;

revoke all on function public.get_clickdesk_self_closed_history() from public, anon;
grant execute on function public.get_clickdesk_self_closed_history() to authenticated;

commit;

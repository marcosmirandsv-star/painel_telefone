-- Regras de seguranca por perfil para o Painel Telefone.
-- Rode este arquivo no Supabase SQL Editor usando o role postgres.

create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_analyst_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select analyst_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_management_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('master', 'coordenadora'), false)
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_analyst_id() to authenticated;
grant execute on function public.is_management_user() to authenticated;

alter table public.profiles enable row level security;
alter table public.analysts enable row level security;
alter table public.goals enable row level security;
alter table public.weekly_individual_metrics enable row level security;
alter table public.weekly_team_metrics enable row level security;

drop policy if exists "profiles_select_own_or_management" on public.profiles;
drop policy if exists "profiles_insert_management" on public.profiles;
drop policy if exists "profiles_update_management" on public.profiles;
drop policy if exists "profiles_delete_management" on public.profiles;

create policy "profiles_select_own_or_management"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_management_user());

create policy "profiles_insert_management"
on public.profiles
for insert
to authenticated
with check (public.is_management_user());

create policy "profiles_update_management"
on public.profiles
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "profiles_delete_management"
on public.profiles
for delete
to authenticated
using (public.is_management_user());

drop policy if exists "analysts_select_management_or_self" on public.analysts;
drop policy if exists "analysts_insert_management" on public.analysts;
drop policy if exists "analysts_update_management" on public.analysts;
drop policy if exists "analysts_delete_management" on public.analysts;

create policy "analysts_select_management_or_self"
on public.analysts
for select
to authenticated
using (public.is_management_user() or id = public.current_user_analyst_id());

create policy "analysts_insert_management"
on public.analysts
for insert
to authenticated
with check (public.is_management_user());

create policy "analysts_update_management"
on public.analysts
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "analysts_delete_management"
on public.analysts
for delete
to authenticated
using (public.is_management_user());

drop policy if exists "goals_select_authenticated" on public.goals;
drop policy if exists "goals_insert_management" on public.goals;
drop policy if exists "goals_update_management" on public.goals;
drop policy if exists "goals_delete_management" on public.goals;

create policy "goals_select_authenticated"
on public.goals
for select
to authenticated
using (true);

create policy "goals_insert_management"
on public.goals
for insert
to authenticated
with check (public.is_management_user());

create policy "goals_update_management"
on public.goals
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "goals_delete_management"
on public.goals
for delete
to authenticated
using (public.is_management_user());

drop policy if exists "individual_metrics_select_management_or_self" on public.weekly_individual_metrics;
drop policy if exists "individual_metrics_insert_management" on public.weekly_individual_metrics;
drop policy if exists "individual_metrics_update_management" on public.weekly_individual_metrics;
drop policy if exists "individual_metrics_delete_management" on public.weekly_individual_metrics;

create policy "individual_metrics_select_management_or_self"
on public.weekly_individual_metrics
for select
to authenticated
using (public.is_management_user() or analyst_id = public.current_user_analyst_id());

create policy "individual_metrics_insert_management"
on public.weekly_individual_metrics
for insert
to authenticated
with check (public.is_management_user());

create policy "individual_metrics_update_management"
on public.weekly_individual_metrics
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "individual_metrics_delete_management"
on public.weekly_individual_metrics
for delete
to authenticated
using (public.is_management_user());

drop policy if exists "team_metrics_select_authenticated" on public.weekly_team_metrics;
drop policy if exists "team_metrics_insert_management" on public.weekly_team_metrics;
drop policy if exists "team_metrics_update_management" on public.weekly_team_metrics;
drop policy if exists "team_metrics_delete_management" on public.weekly_team_metrics;

create policy "team_metrics_select_authenticated"
on public.weekly_team_metrics
for select
to authenticated
using (true);

create policy "team_metrics_insert_management"
on public.weekly_team_metrics
for insert
to authenticated
with check (public.is_management_user());

create policy "team_metrics_update_management"
on public.weekly_team_metrics
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "team_metrics_delete_management"
on public.weekly_team_metrics
for delete
to authenticated
using (public.is_management_user());

drop policy if exists "evidencias_select_authenticated" on storage.objects;
drop policy if exists "evidencias_insert_management" on storage.objects;
drop policy if exists "evidencias_update_management" on storage.objects;
drop policy if exists "evidencias_delete_management" on storage.objects;

create policy "evidencias_select_authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'evidencias');

create policy "evidencias_insert_management"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'evidencias' and public.is_management_user());

create policy "evidencias_update_management"
on storage.objects
for update
to authenticated
using (bucket_id = 'evidencias' and public.is_management_user())
with check (bucket_id = 'evidencias' and public.is_management_user());

create policy "evidencias_delete_management"
on storage.objects
for delete
to authenticated
using (bucket_id = 'evidencias' and public.is_management_user());

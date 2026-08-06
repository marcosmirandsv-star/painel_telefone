-- Ajuste manual do podio mensal do chat.
-- Rode no Supabase SQL Editor do projeto correto.

create table if not exists public.chat_podium_manual (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.chat_teams(id) on delete cascade,
  analyst_id uuid not null references public.chat_analysts(id) on delete cascade,
  year integer not null,
  month_number integer not null check (month_number between 1 and 12),
  position integer not null check (position between 1 and 3),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (team_id, year, month_number, position),
  unique (team_id, year, month_number, analyst_id)
);

alter table public.chat_podium_manual enable row level security;

drop policy if exists "chat_podium_manual_select_management" on public.chat_podium_manual;
drop policy if exists "chat_podium_manual_insert_management" on public.chat_podium_manual;
drop policy if exists "chat_podium_manual_update_management" on public.chat_podium_manual;
drop policy if exists "chat_podium_manual_delete_management" on public.chat_podium_manual;

create policy "chat_podium_manual_select_management"
on public.chat_podium_manual
for select
to authenticated
using (public.is_management_user());

create policy "chat_podium_manual_insert_management"
on public.chat_podium_manual
for insert
to authenticated
with check (public.is_management_user());

create policy "chat_podium_manual_update_management"
on public.chat_podium_manual
for update
to authenticated
using (public.is_management_user())
with check (public.is_management_user());

create policy "chat_podium_manual_delete_management"
on public.chat_podium_manual
for delete
to authenticated
using (public.is_management_user());

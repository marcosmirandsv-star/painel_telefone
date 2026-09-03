-- Ajustes manuais do podio do modulo Telefone por periodo.
-- Execute no Supabase SQL Editor com o role postgres.

create table if not exists public.phone_podium_manual (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references public.analysts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  position integer not null check (position between 1 and 3),
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (period_start, period_end, position),
  unique (period_start, period_end, analyst_id)
);

alter table public.phone_podium_manual enable row level security;

drop policy if exists "phone_podium_manual_select_authenticated" on public.phone_podium_manual;
drop policy if exists "phone_podium_manual_insert_management" on public.phone_podium_manual;
drop policy if exists "phone_podium_manual_delete_management" on public.phone_podium_manual;

create policy "phone_podium_manual_select_authenticated"
on public.phone_podium_manual for select to authenticated using (true);

create policy "phone_podium_manual_insert_management"
on public.phone_podium_manual for insert to authenticated
with check (public.is_management_user() and (created_by = auth.uid() or created_by is null));

create policy "phone_podium_manual_delete_management"
on public.phone_podium_manual for delete to authenticated
using (public.is_management_user());


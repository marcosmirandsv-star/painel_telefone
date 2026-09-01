-- Historico auditavel das importacoes mensais do modulo Chat.
-- Execute no Supabase SQL Editor com o role postgres.

create table if not exists public.chat_import_history (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  month_number integer not null check (month_number between 1 and 12),
  month_label text not null,
  satisfaction_file_name text not null,
  satisfaction_file_size bigint not null default 0,
  satisfaction_rows integer not null default 0,
  inactivity_file_name text not null,
  inactivity_file_size bigint not null default 0,
  inactivity_rows integer not null default 0,
  analysts_processed integer not null default 0,
  status text not null default 'completed' check (status in ('completed', 'failed')),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists chat_import_history_created_at_idx
  on public.chat_import_history (created_at desc);

alter table public.chat_import_history enable row level security;

drop policy if exists "chat_import_history_select_management" on public.chat_import_history;
drop policy if exists "chat_import_history_insert_management" on public.chat_import_history;

create policy "chat_import_history_select_management"
on public.chat_import_history
for select
to authenticated
using (public.is_management_user());

create policy "chat_import_history_insert_management"
on public.chat_import_history
for insert
to authenticated
with check (public.is_management_user() and (created_by = auth.uid() or created_by is null));


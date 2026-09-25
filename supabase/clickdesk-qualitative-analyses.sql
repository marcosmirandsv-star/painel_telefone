-- Homologação: cache leve da análise qualitativa ClickDesk.
-- O transcript continua no ClickDesk; esta tabela guarda somente a ficha estruturada da análise.

create table if not exists public.clickdesk_qualitative_analyses (
  id uuid primary key default gen_random_uuid(),
  clickdesk_ticket_id text not null unique,
  analyst_id uuid not null references public.chat_analysts(id) on delete cascade,
  occurred_date date,
  area text,
  satisfaction_label text,
  analysis jsonb not null check (jsonb_typeof(analysis) = 'object'),
  model text,
  transcript_hash text,
  transcript_characters integer not null default 0 check (transcript_characters >= 0),
  created_by uuid references auth.users(id) on delete set null,
  validation_status text not null default 'pending'
    check (validation_status in ('pending','approved','rejected')),
  validated_by uuid references auth.users(id) on delete set null,
  validated_at timestamptz,
  validation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clickdesk_qualitative_analyses
  add column if not exists validation_status text not null default 'pending',
  add column if not exists validated_by uuid references auth.users(id) on delete set null,
  add column if not exists validated_at timestamptz,
  add column if not exists validation_notes text;

alter table public.clickdesk_qualitative_analyses
  drop constraint if exists clickdesk_qualitative_analyses_validation_status_check;

alter table public.clickdesk_qualitative_analyses
  add constraint clickdesk_qualitative_analyses_validation_status_check
  check (validation_status in ('pending','approved','rejected'));

alter table public.clickdesk_qualitative_analyses enable row level security;

grant select on public.clickdesk_qualitative_analyses to authenticated;
grant select, insert, update, delete on public.clickdesk_qualitative_analyses to service_role;

drop policy if exists "management can read qualitative analyses"
  on public.clickdesk_qualitative_analyses;
drop policy if exists "analysts can read own qualitative analyses"
  on public.clickdesk_qualitative_analyses;
drop policy if exists "authorized users can read qualitative analyses"
  on public.clickdesk_qualitative_analyses;

create policy "authorized users can read qualitative analyses"
on public.clickdesk_qualitative_analyses
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(p.role::text) in ('master', 'coordenadora', 'coordinator')
        or p.chat_analyst_id = analyst_id
      )
  )
);

create index if not exists clickdesk_qualitative_analyses_analyst_date_idx
  on public.clickdesk_qualitative_analyses (analyst_id, occurred_date desc);

create index if not exists clickdesk_qualitative_analyses_created_by_idx
  on public.clickdesk_qualitative_analyses (created_by);

create index if not exists clickdesk_qualitative_analyses_validation_status_idx
  on public.clickdesk_qualitative_analyses (validation_status);

create index if not exists clickdesk_qualitative_analyses_validated_by_idx
  on public.clickdesk_qualitative_analyses (validated_by);

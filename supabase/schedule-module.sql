-- Homologação do módulo de escalas.
-- Aplicar SOMENTE no projeto Supabase de homologação.
begin;

create table if not exists public.schedule_teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  manager_name text,
  manager_profile_id uuid references public.profiles(id) on delete set null,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  active boolean not null default true,
  phone_analyst_id uuid references public.analysts(id) on delete set null,
  chat_analyst_id uuid references public.chat_analysts(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(email)
);

create table if not exists public.schedule_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.schedule_people(id) on delete cascade,
  team_id uuid not null references public.schedule_teams(id) on delete cascade,
  manager_profile_id uuid references public.profiles(id) on delete set null,
  start_date date not null,
  end_date date,
  participates_in_schedule boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index if not exists schedule_memberships_person_dates_idx
  on public.schedule_memberships(person_id, start_date, end_date);

create table if not exists public.schedule_rules (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.schedule_teams(id) on delete cascade,
  person_id uuid references public.schedule_people(id) on delete cascade,
  rule_key text not null,
  rule_value jsonb not null default '{}'::jsonb,
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table if not exists public.schedule_month_contexts (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  month integer not null check (month between 1 and 12),
  holidays jsonb not null default '[]'::jsonb,
  optional_days jsonb not null default '[]'::jsonb,
  click_days jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(year, month)
);

create table if not exists public.schedule_absences (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.schedule_people(id) on delete cascade,
  kind text not null check (kind in ('FERIAS','DAY_OFF','FOLGA','PREMIACAO','BANCO_HORAS','SENAC','OUTRA')),
  start_date date not null,
  end_date date not null,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.schedule_people(id) on delete cascade,
  team_id uuid not null references public.schedule_teams(id) on delete cascade,
  date date not null,
  entry_type text not null check (entry_type in ('hybrid','lunch','snack','extended','saturday')),
  value text not null,
  source text not null default 'generated' check (source in ('generated','manual','exception')),
  locked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(person_id, team_id, date, entry_type)
);

create table if not exists public.schedule_publications (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.schedule_teams(id) on delete cascade,
  year integer not null,
  month integer not null check (month between 1 and 12),
  released boolean not null default false,
  released_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,
  unique(team_id, year, month)
);

create table if not exists public.schedule_requests (
  id uuid primary key default gen_random_uuid(),
  requester_person_id uuid references public.schedule_people(id) on delete set null,
  requester_name text not null,
  requester_email text,
  team_id uuid not null references public.schedule_teams(id) on delete cascade,
  target_date date not null,
  request_type text not null,
  requested_value text,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.schedule_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  receive_all boolean not null default false,
  active boolean not null default true,
  unique(team_id, profile_id)
);

create table if not exists public.schedule_notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.schedule_requests(id) on delete cascade,
  title text not null,
  message text not null,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_public_links (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  team_id uuid references public.schedule_teams(id) on delete cascade,
  year integer,
  month integer check (month between 1 and 12),
  active boolean not null default true,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.schedule_teams (code, name, manager_name)
values
  ('outros','Suporte Outros','Polyana'),
  ('especializado','Suporte Especializado','Marcos'),
  ('telefone','Telefone','Marcos'),
  ('implantacao','Implantação','Carine'),
  ('n2','N2','Carine'),
  ('lideranca','Liderança',null),
  ('sabados','Sábados',null)
on conflict (code) do update set
  name = excluded.name,
  manager_name = excluded.manager_name;

alter table public.schedule_teams enable row level security;
alter table public.schedule_people enable row level security;
alter table public.schedule_memberships enable row level security;
alter table public.schedule_rules enable row level security;
alter table public.schedule_month_contexts enable row level security;
alter table public.schedule_absences enable row level security;
alter table public.schedule_entries enable row level security;
alter table public.schedule_publications enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.schedule_notification_recipients enable row level security;
alter table public.schedule_notifications enable row level security;
alter table public.schedule_public_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'schedule_teams','schedule_people','schedule_memberships','schedule_rules',
    'schedule_month_contexts','schedule_absences','schedule_entries',
    'schedule_publications','schedule_requests','schedule_notification_recipients',
    'schedule_notifications','schedule_public_links'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_management_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_management_user()) with check (public.is_management_user())',
      t || '_management_all', t
    );
  end loop;
end $$;

drop policy if exists schedule_notifications_select_own on public.schedule_notifications;
create policy schedule_notifications_select_own
on public.schedule_notifications
for select
to authenticated
using (profile_id = auth.uid() or public.is_management_user());

drop policy if exists schedule_notifications_update_own on public.schedule_notifications;
create policy schedule_notifications_update_own
on public.schedule_notifications
for update
to authenticated
using (profile_id = auth.uid() or public.is_management_user())
with check (profile_id = auth.uid() or public.is_management_user());

create or replace function public.notify_schedule_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.schedule_notifications(profile_id, request_id, title, message)
  select distinct r.profile_id, new.id, 'Nova solicitação de escala',
    new.requester_name || ' enviou uma solicitação para ' || to_char(new.target_date, 'DD/MM/YYYY') || '.'
  from public.schedule_notification_recipients r
  where r.active
    and (r.receive_all or r.team_id = new.team_id);
  return new;
end;
$$;

drop trigger if exists notify_schedule_request_trigger on public.schedule_requests;
create trigger notify_schedule_request_trigger
after insert on public.schedule_requests
for each row execute function public.notify_schedule_request();

do $$
begin
  alter publication supabase_realtime add table public.schedule_notifications;
exception
  when duplicate_object then null;
end $$;

commit;

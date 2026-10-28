-- Cadastro operacional de pessoas, equipes e férias.
-- Dados de férias são visíveis e editáveis apenas por master/coordenadora.

create table if not exists public.workforce_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_person_id uuid null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workforce_people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  photo_url text null,
  team_id uuid null references public.workforce_teams(id) on delete set null,
  manager_person_id uuid null,
  phone_analyst_id uuid null unique references public.analysts(id) on delete set null,
  chat_analyst_id uuid null unique references public.chat_analysts(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workforce_teams
  add constraint workforce_teams_manager_person_id_fkey
  foreign key (manager_person_id) references public.workforce_people(id) on delete set null;

alter table public.workforce_people
  add constraint workforce_people_manager_person_id_fkey
  foreign key (manager_person_id) references public.workforce_people(id) on delete set null;

create table if not exists public.workforce_assignment_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.workforce_people(id) on delete cascade,
  team_id uuid null references public.workforce_teams(id) on delete set null,
  manager_person_id uuid null references public.workforce_people(id) on delete set null,
  starts_on date not null default current_date,
  ends_on date null,
  reason text null,
  created_at timestamptz not null default now(),
  constraint workforce_assignment_history_dates_check check (ends_on is null or ends_on >= starts_on)
);

create table if not exists public.vacation_periods (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.workforce_people(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days integer generated always as ((end_date - start_date) + 1) stored,
  status text not null default 'planned' check (status in ('planned', 'scheduled', 'cancelled')),
  hr_ticket text null,
  cash_bonus_days smallint null check (cash_bonus_days is null or cash_bonus_days between 0 and 10),
  thirteenth_advance boolean null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vacation_periods_dates_check check (end_date >= start_date)
);

create index if not exists workforce_people_team_active_idx on public.workforce_people(team_id, active);
create index if not exists workforce_assignment_history_person_dates_idx on public.workforce_assignment_history(person_id, starts_on, ends_on);
create index if not exists vacation_periods_person_dates_idx on public.vacation_periods(person_id, start_date, end_date);
create index if not exists vacation_periods_active_dates_idx on public.vacation_periods(start_date, end_date) where status <> 'cancelled';

alter table public.workforce_teams enable row level security;
alter table public.workforce_people enable row level security;
alter table public.workforce_assignment_history enable row level security;
alter table public.vacation_periods enable row level security;

create policy workforce_teams_management_only on public.workforce_teams
  for all to authenticated
  using ((select public.is_management_user()))
  with check ((select public.is_management_user()));

create policy workforce_people_management_only on public.workforce_people
  for all to authenticated
  using ((select public.is_management_user()))
  with check ((select public.is_management_user()));

create policy workforce_assignment_history_management_only on public.workforce_assignment_history
  for all to authenticated
  using ((select public.is_management_user()))
  with check ((select public.is_management_user()));

create policy vacation_periods_management_only on public.vacation_periods
  for all to authenticated
  using ((select public.is_management_user()))
  with check ((select public.is_management_user()));

-- Equipes e pessoas existentes: mantemos o nome atual da operação e suas fotos.
insert into public.workforce_teams(name)
select distinct ct.name from public.chat_teams ct
where ct.name is not null
on conflict (name) do nothing;

insert into public.workforce_teams(name)
values ('Telefone'), ('Implantação'), ('N3'), ('Liderança')
on conflict (name) do nothing;

insert into public.workforce_people(name, photo_url, team_id, chat_analyst_id, active)
select ca.name, ca.photo_url, wt.id, ca.id, ca.active
from public.chat_analysts ca
join public.chat_teams ct on ct.id = ca.team_id
join public.workforce_teams wt on wt.name = ct.name
on conflict (name) do update set
  photo_url = coalesce(excluded.photo_url, public.workforce_people.photo_url),
  chat_analyst_id = excluded.chat_analyst_id,
  active = excluded.active,
  updated_at = now();

insert into public.workforce_people(name, photo_url, team_id, phone_analyst_id, active)
select a.name, a.photo_url, wt.id, a.id, a.active
from public.analysts a
join public.workforce_teams wt on wt.name = 'Telefone'
on conflict (name) do update set
  photo_url = coalesce(excluded.photo_url, public.workforce_people.photo_url),
  team_id = excluded.team_id,
  phone_analyst_id = excluded.phone_analyst_id,
  active = excluded.active,
  updated_at = now();

insert into public.workforce_people(name, team_id)
select v.name, wt.id
from (values
  ('Mateus Rodrigues', 'Implantação'),
  ('Sabrina Jardim', 'N3'),
  ('Thomaz Luiz', 'N3'),
  ('Vitor Kaique', 'N3'),
  ('Ismael Bessa', 'N3'),
  ('Ariane Moreira', 'Liderança'),
  ('Luis Gustavo', 'Liderança'),
  ('Marcos Miranda', 'Liderança'),
  ('Polyana Ventura', 'Liderança')
) as v(name, team_name)
join public.workforce_teams wt on wt.name = v.team_name
on conflict (name) do update set team_id = excluded.team_id, active = true, updated_at = now();

-- Gestões já explícitas no cadastro do chat.
update public.workforce_teams wt
set manager_person_id = wp.id, updated_at = now()
from public.workforce_people wp
where (wt.name = 'Marcos Miranda - Chat Notas' and wp.name = 'Marcos Miranda')
   or (wt.name = 'Polyana Ventura - Chat Outros' and wp.name = 'Polyana Ventura');

insert into public.workforce_assignment_history(person_id, team_id, manager_person_id, starts_on, reason)
select wp.id, wp.team_id, wt.manager_person_id, current_date, 'Carga inicial do cadastro de férias'
from public.workforce_people wp
left join public.workforce_teams wt on wt.id = wp.team_id
where not exists (
  select 1 from public.workforce_assignment_history h where h.person_id = wp.id
);

-- Extensão do módulo de escalas: rodízio de sábados e bootstrap de pessoas existentes.
begin;

create table if not exists public.schedule_saturday_members (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.schedule_people(id) on delete cascade,
  role text not null default 'rotating' check (role in ('fixed','rotating')),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(person_id, start_date),
  check (end_date is null or end_date >= start_date)
);

alter table public.schedule_saturday_members enable row level security;
drop policy if exists schedule_saturday_members_management_all on public.schedule_saturday_members;
create policy schedule_saturday_members_management_all
on public.schedule_saturday_members
for all to authenticated
using (public.is_management_user())
with check (public.is_management_user());

-- Reaproveita os cadastros já existentes em Telefone e Chat sem duplicar os módulos legados.
insert into public.schedule_people (name, phone_analyst_id, active)
select a.name, a.id, a.active
from public.analysts a
where not exists (
  select 1 from public.schedule_people p where p.phone_analyst_id = a.id
);

insert into public.schedule_people (name, chat_analyst_id, active)
select a.name, a.id, a.active
from public.chat_analysts a
where not exists (
  select 1 from public.schedule_people p where p.chat_analyst_id = a.id
)
and not exists (
  select 1 from public.schedule_people p where lower(trim(p.name)) = lower(trim(a.name))
);

update public.schedule_people p
set chat_analyst_id = ca.id
from public.chat_analysts ca
where p.chat_analyst_id is null
  and lower(trim(p.name)) = lower(trim(ca.name));

commit;

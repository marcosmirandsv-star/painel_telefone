-- O cadastro de analistas continua sendo a fonte oficial de nome, foto e situação ativa.
-- A base de gestão de pessoas armazena somente os dados complementares: lotação, gestor e férias.

create or replace function public.sync_workforce_from_phone_analyst()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  phone_team_id uuid;
begin
  select id into phone_team_id from public.workforce_teams where name = 'Telefone';

  if exists (select 1 from public.workforce_people where phone_analyst_id = new.id) then
    update public.workforce_people
      set name = new.name,
          photo_url = new.photo_url,
          active = new.active,
          updated_at = now()
    where phone_analyst_id = new.id;
  else
    insert into public.workforce_people(name, photo_url, team_id, phone_analyst_id, active)
    values (new.name, new.photo_url, phone_team_id, new.id, new.active)
    on conflict (name) do update set
      photo_url = coalesce(excluded.photo_url, public.workforce_people.photo_url),
      phone_analyst_id = excluded.phone_analyst_id,
      active = excluded.active,
      updated_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.sync_workforce_from_chat_analyst()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workforce_team_id uuid;
begin
  select wt.id into workforce_team_id
  from public.chat_teams ct
  join public.workforce_teams wt on wt.name = ct.name
  where ct.id = new.team_id;

  if exists (select 1 from public.workforce_people where chat_analyst_id = new.id) then
    update public.workforce_people
      set name = new.name,
          photo_url = new.photo_url,
          active = new.active,
          team_id = case when phone_analyst_id is null then workforce_team_id else team_id end,
          updated_at = now()
    where chat_analyst_id = new.id;
  else
    insert into public.workforce_people(name, photo_url, team_id, chat_analyst_id, active)
    values (new.name, new.photo_url, workforce_team_id, new.id, new.active)
    on conflict (name) do update set
      photo_url = coalesce(excluded.photo_url, public.workforce_people.photo_url),
      chat_analyst_id = excluded.chat_analyst_id,
      active = excluded.active,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists workforce_sync_phone_analyst on public.analysts;
create trigger workforce_sync_phone_analyst
after insert or update of name, photo_url, active on public.analysts
for each row execute function public.sync_workforce_from_phone_analyst();

drop trigger if exists workforce_sync_chat_analyst on public.chat_analysts;
create trigger workforce_sync_chat_analyst
after insert or update of name, photo_url, active, team_id on public.chat_analysts
for each row execute function public.sync_workforce_from_chat_analyst();

-- Provisionamento de acesso de homologação para analistas do Chat.
-- A allowlist passa a guardar o vínculo independente do Chat e o gatilho
-- replica esse vínculo para profiles quando o usuário é criado.

begin;

alter table public.homologation_access_allowlist
  add column if not exists chat_analyst_id uuid
  references public.chat_analysts(id) on delete set null;

create index if not exists homologation_access_allowlist_chat_analyst_idx
  on public.homologation_access_allowlist (chat_analyst_id);

create or replace function public.handle_homologation_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed public.homologation_access_allowlist%rowtype;
begin
  select *
  into allowed
  from public.homologation_access_allowlist
  where lower(email)=lower(new.email)
  limit 1;

  if allowed.email is null then
    raise exception 'E-mail não autorizado para o ambiente de homologação.';
  end if;

  insert into public.profiles(
    id,
    full_name,
    role,
    analyst_id,
    chat_analyst_id,
    created_at
  )
  values(
    new.id,
    allowed.full_name,
    allowed.role,
    allowed.analyst_id,
    allowed.chat_analyst_id,
    now()
  )
  on conflict(id) do update set
    full_name=excluded.full_name,
    role=excluded.role,
    analyst_id=excluded.analyst_id,
    chat_analyst_id=excluded.chat_analyst_id;

  return new;
end;
$$;

revoke execute on function public.handle_homologation_auth_signup()
  from public, anon, authenticated;

commit;

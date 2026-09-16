-- Execute once in the SQL Editor of the same Supabase project as the dashboard.
begin;
create table if not exists public.integration_closures (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  channel text not null check (channel in ('telefone', 'chat')),
  team text not null default 'all',
  payload jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(month, channel, team)
);
alter table public.integration_closures enable row level security;
revoke all on public.integration_closures from anon, authenticated;
grant select, insert on public.integration_closures to service_role;
revoke update, delete, truncate on public.integration_closures from service_role;

create or replace function public.prevent_closure_changes() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Fechamentos aprovados são imutáveis.';
end;
$$;
drop trigger if exists preserve_integration_closure on public.integration_closures;
create trigger preserve_integration_closure before update or delete on public.integration_closures
for each row execute function public.prevent_closure_changes();

create table if not exists public.integration_usage (
  consumer text primary key,
  minute timestamptz not null,
  requests integer not null
);
alter table public.integration_usage enable row level security;
revoke all on public.integration_usage from anon, authenticated;
create or replace function public.consume_integration_request(consumer_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  insert into public.integration_usage as usage (consumer, minute, requests)
  values (consumer_id, date_trunc('minute', now()), 1)
  on conflict (consumer) do update set
    minute = date_trunc('minute', now()),
    requests = case when usage.minute = date_trunc('minute', now()) then least(usage.requests + 1, 61) else 1 end
  returning requests into used;
  return used <= 60;
end;
$$;
revoke all on function public.consume_integration_request(text) from public, anon, authenticated;
grant execute on function public.consume_integration_request(text) to service_role;
commit;

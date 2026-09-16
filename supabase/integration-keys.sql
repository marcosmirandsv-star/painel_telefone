-- Additive migration: existing indicators, closures and environment keys stay intact.
begin;
create table if not exists public.integration_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 3 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null check (prefix ~ '^cp_[A-Za-z0-9_-]{8}$'),
  channels text[] not null check (
    cardinality(channels) between 1 and 2
    and channels <@ array['telefone','chat']::text[]
    and array_position(channels, null) is null
  ),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  expires_at timestamptz not null check (expires_at > created_at),
  revoked_at timestamptz,
  revoked_by uuid,
  check ((revoked_at is null) = (revoked_by is null))
);
alter table public.integration_keys enable row level security;
revoke all on public.integration_keys from public, anon, authenticated;
revoke all on public.integration_keys from service_role;
grant select, insert on public.integration_keys to service_role;
grant update (revoked_at, revoked_by) on public.integration_keys to service_role;
create index if not exists integration_keys_created_idx on public.integration_keys(created_at desc, id);
comment on table public.integration_keys is 'Integration credentials: SHA-256 hashes only; managed by Master through server routes.';
commit;

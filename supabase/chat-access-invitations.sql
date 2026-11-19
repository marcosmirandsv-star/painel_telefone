-- Prepared invitation roster for the existing production Chat analysts.
-- Corporate email addresses are seeded privately in the database, never in the repository.
create table if not exists public.chat_access_invitations (
  analyst_id uuid primary key references public.chat_analysts(id) on delete restrict,
  email text not null unique,
  status text not null default 'pending'
    check (status in ('pending','sending','invited','failed','link_failed')),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  invited_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.chat_access_invitations enable row level security;
-- The browser cannot read or update this table directly, even when authenticated.
revoke all on table public.chat_access_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_access_invitations to service_role;
comment on table public.chat_access_invitations is
  'Chat email invitations managed only through the management-authorized server route.';

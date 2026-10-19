
create table public.clickdesk_registry_revision(singleton boolean primary key default true check(singleton),changed_at timestamptz not null default 'epoch');
alter table public.clickdesk_registry_revision enable row level security;
revoke all on public.clickdesk_registry_revision from anon,authenticated;
grant all on public.clickdesk_registry_revision to service_role;
insert into public.clickdesk_registry_revision(singleton) values(true);
create function public.note_clickdesk_registry_revision()
returns trigger language plpgsql security definer set search_path='' as $$
begin update public.clickdesk_registry_revision set changed_at=now() where singleton; return new; end $$;
revoke all on function public.note_clickdesk_registry_revision() from public,anon,authenticated;
create trigger clickdesk_registry_name_changed after insert or update of name,legacy_name on public.chat_analysts
for each row execute function public.note_clickdesk_registry_revision();

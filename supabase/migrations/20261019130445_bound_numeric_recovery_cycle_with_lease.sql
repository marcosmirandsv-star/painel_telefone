create table public.clickdesk_reconciliation_cycle(singleton boolean primary key default true check(singleton),lease_token uuid,lease_until timestamptz);
alter table public.clickdesk_reconciliation_cycle enable row level security;
revoke all on public.clickdesk_reconciliation_cycle from public,anon,authenticated;
grant all on public.clickdesk_reconciliation_cycle to service_role;
insert into public.clickdesk_reconciliation_cycle(singleton)values(true);
create function public.claim_clickdesk_reconciliation_cycle()returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid();
begin
 update public.clickdesk_reconciliation_cycle set lease_token=token,lease_until=now()+interval '110 seconds' where singleton and (lease_until is null or lease_until<now());
 if not found then return null; end if; return token;
end $$;
revoke all on function public.claim_clickdesk_reconciliation_cycle() from public,anon,authenticated;
grant execute on function public.claim_clickdesk_reconciliation_cycle() to service_role;
create or replace function public.claim_clickdesk_reconciliation_cycle()returns uuid language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid();
begin
 update public.clickdesk_reconciliation_cycle set lease_token=token,lease_until=now()+interval '200 seconds' where singleton and (lease_until is null or lease_until<now());
 if not found then return null; end if; return token;
end $$;
revoke all on function public.claim_clickdesk_reconciliation_cycle() from public,anon,authenticated;
grant execute on function public.claim_clickdesk_reconciliation_cycle() to service_role;
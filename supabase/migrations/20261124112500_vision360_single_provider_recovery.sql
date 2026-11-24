begin;
-- One scoped recovery slot after production integration failures and provider503.
-- Attempts are preserved. Every other ticket retains the original limit of three.
do $$
begin
 if not exists(select 1 from public.clickdesk_360_work_queue
  where ticket_id='1098006' and status='failed' and attempts=3
   and error_code='provider_http_503' and lease_token is null
   and updated_at+interval '5 minutes'<=clock_timestamp())
  or exists(select 1 from public.clickdesk_qualitative_analyses where clickdesk_ticket_id='1098006')
 then raise exception 'Scoped recovery preconditions changed';end if;
end;
$$;
alter table public.clickdesk_360_work_queue drop constraint clickdesk_360_work_queue_attempts_check;
alter table public.clickdesk_360_work_queue add constraint clickdesk_360_work_queue_attempts_check
 check((attempts>=0 and attempts<=3) or (ticket_id='1098006' and attempts=4));
commit;


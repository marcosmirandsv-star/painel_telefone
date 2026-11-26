-- Applied to production qmetbydkepfdgfqkdkai on 2026-11-23; scoped recovery.
-- This resumes the existing November inventory, never resets it and never retries error state.
-- No application automation, AI dispatch, ledger writes or other cron jobs are changed.
begin;
create schema if not exists clickdesk_recovery_private;
revoke all on schema clickdesk_recovery_private from public,anon,authenticated;
create table if not exists clickdesk_recovery_private.inventory_nov_resume (
 period_key text primary key check(period_key='2026-11'),
 created_at timestamptz not null default clock_timestamp(),
 deadline_at timestamptz not null default clock_timestamp()+interval '24 hours',
 dispatches integer not null default 0,
 consecutive_failures integer not null default 0,
 last_request_id bigint,
 last_dispatch_at timestamptz,
 response_checked boolean not null default true,
 last_http_status integer,
 stopped_at timestamptz,
 stop_reason text,
 check(dispatches between 0 and 720),
 check(consecutive_failures>=0)
);
alter table clickdesk_recovery_private.inventory_nov_resume enable row level security;
revoke all on clickdesk_recovery_private.inventory_nov_resume from public,anon,authenticated;
-- Idempotent: rerunning never extends the deadline, clears failures or rearms a stopped run.
insert into clickdesk_recovery_private.inventory_nov_resume(period_key)
values('2026-11') on conflict(period_key) do nothing;

create or replace function clickdesk_recovery_private.tick_inventory_nov_2026()
returns void language plpgsql security invoker set search_path='' as $$
declare
 c clickdesk_recovery_private.inventory_nov_resume%rowtype;
 inventory_status text;
 inventory_lease timestamptz;
 reason text;
 token text;
 request_id bigint;
 http_status integer;
 timed_out boolean;
 response_exists boolean;
 jid bigint;
begin
 -- Serializes duplicate/manual invocations before checking either durable state or HTTP results.
 if not pg_try_advisory_xact_lock(202611,2302) then return; end if;
 select * into c from clickdesk_recovery_private.inventory_nov_resume
 where period_key='2026-11' for update;
 if not found then return; end if;
 begin
   select i.status,i.lease_until into inventory_status,inventory_lease
   from public.clickdesk_period_inventory i where i.period_key='2026-11';
   if c.stopped_at is not null then reason:=coalesce(c.stop_reason,'already_stopped');
   elsif clock_timestamp()>=c.deadline_at then reason:='deadline_24h';
   elsif inventory_status is null then reason:='inventory_missing';
   elsif inventory_status='complete' then reason:='inventory_complete';
   elsif inventory_status='error' then reason:='inventory_error';
   elsif inventory_status<>'running' then reason:='inventory_not_running';
   elsif c.dispatches>=720 then reason:='dispatch_limit';
   end if;

   if reason is null and not c.response_checked and c.last_request_id is not null then
     -- pg_net keeps response metadata asynchronously. Never store or print response bodies,
     -- headers, error text or decrypted credentials.
     select r.status_code,r.timed_out into http_status,timed_out
     from net._http_response r where r.id=c.last_request_id;
     response_exists:=found;
     if not response_exists and clock_timestamp()<c.last_dispatch_at+interval '90 seconds' then return; end if;
     if response_exists and http_status between 200 and 299 and not coalesce(timed_out,false) then
       c.consecutive_failures:=0;
     else
       c.consecutive_failures:=c.consecutive_failures+1;
     end if;
     update clickdesk_recovery_private.inventory_nov_resume set
       consecutive_failures=c.consecutive_failures,response_checked=true,last_http_status=http_status
     where period_key='2026-11';
     if c.consecutive_failures>=3 then reason:='three_dispatch_failures'; end if;
   end if;

   if reason is null then
     -- The edge worker owns the authoritative lease and checkpoint. Do not modify either.
     if inventory_lease is not null and inventory_lease>clock_timestamp() then return; end if;
     select decrypted_secret into strict token from vault.decrypted_secrets
     where name='clickdesk_cron_token';
     if nullif(token,'') is null then reason:='credential_unavailable';
     else
       select net.http_post(
         url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-period-inventory',
         headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
         body:='{"month":"2026-11","restart":false}'::jsonb,
         timeout_milliseconds:=15000
       ) into request_id;
       token:=null;
       if request_id is null then reason:='dispatch_enqueue_failed';
       else
         update clickdesk_recovery_private.inventory_nov_resume set
           dispatches=dispatches+1,last_request_id=request_id,last_dispatch_at=clock_timestamp(),response_checked=false
         where period_key='2026-11';
         return;
       end if;
     end if;
   end if;
 exception when others then
   -- Fail closed, without putting potentially sensitive exception text in cron logs.
   reason:='tick_failed';
 end;
 update clickdesk_recovery_private.inventory_nov_resume set
   stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,reason)
 where period_key='2026-11';
 -- Only this exact named job, in this database and owned by this invoker, can be removed.
 for jid in select jobid from cron.job
   where jobname='clickdesk-inventory-nov-2026-resume-2m'
   and database=current_database() and username=current_user
 loop perform cron.unschedule(jid); end loop;
end;
$$;
revoke all on function clickdesk_recovery_private.tick_inventory_nov_2026() from public,anon,authenticated;

-- Creation deliberately does not invoke the endpoint. First dispatch is the next 2-minute tick.
do $$
begin
 if exists(select 1 from clickdesk_recovery_private.inventory_nov_resume c
   join public.clickdesk_period_inventory i using(period_key)
   where c.period_key='2026-11' and c.stopped_at is null
     and c.deadline_at>clock_timestamp() and i.status='running') then
   perform cron.schedule('clickdesk-inventory-nov-2026-resume-2m','*/2 * * * *',
     'select clickdesk_recovery_private.tick_inventory_nov_2026();');
 end if;
end;
$$;
commit;

-- Safe status inspection after application (no secret values):
-- select period_key,created_at,deadline_at,dispatches,consecutive_failures,
--   last_request_id,last_dispatch_at,last_http_status,stopped_at,stop_reason
-- from clickdesk_recovery_private.inventory_nov_resume;
-- select jobid,jobname,schedule,active from cron.job
-- where jobname='clickdesk-inventory-nov-2026-resume-2m';



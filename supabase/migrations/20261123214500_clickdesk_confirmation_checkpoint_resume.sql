-- Applied to production qmetbydkepfdgfqkdkai on 2026-11-23; scoped recovery.
-- Requires PR118 production + candidate RPCs already deployed.
-- It does not invoke Gemini. Uses the existing ledger/queue behavior of that API.
begin;
set local time zone 'UTC';

-- Same RPC signature: November now skips fresh, already checked candidate versions.
-- Other periods and unscoped callers retain original discovery behavior.
create or replace function public.clickdesk_reconcile_candidate_page(
 p_cursor text default '',p_limit integer default 6,p_period text default null
) returns table(ticket_id text,version text)
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
begin
 if p_limit is null or p_limit<1 or p_limit>12 or p_cursor is null or length(p_cursor)>80
   or (p_period is not null and p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then
   raise exception 'Invalid reconcile page parameters' using errcode='22023';
 end if;
 if p_period is not null then
   return query
   select i.ticket_id,coalesce(to_char(v.latest at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'')
   from public.clickdesk_period_inventory_candidates i
   cross join lateral (
     select max(s.source_updated_at) latest from (
       select i.source_updated_at
       union all select a.updated_at from public.clickdesk_chat_attendances a where a.clickdesk_ticket_id::text=i.ticket_id
       union all select c.verified_at from public.clickdesk_chat_verified_contributions c where c.ticket_id::text=i.ticket_id
       union all select q.source_updated_at from public.clickdesk_chat_capture_queue q where q.ticket_id::text=i.ticket_id
     ) s
   ) v
   where i.period_key=p_period and i.ticket_id collate "C">p_cursor collate "C"
     and (p_period<>'2026-11' or (
       not exists(select 1 from public.clickdesk_final_ticket_pending p
         where p.ticket_id=i.ticket_id and p.checked_at>=v.latest)
       and not exists(select 1 from public.clickdesk_final_ticket_ledger l
         where l.ticket_id=i.ticket_id and l.verified_at>=v.latest
         and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=i.ticket_id))
     ))
   order by i.ticket_id collate "C" limit p_limit+1;
 else
   return query select c.ticket_id,coalesce(to_char(c.source_updated_at at time zone 'UTC',
     'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'')
   from public.clickdesk_reconcile_candidates(null) c
   where c.ticket_id collate "C">p_cursor collate "C"
   order by c.ticket_id collate "C" limit p_limit+1;
 end if;
end;
$$;
revoke all on function public.clickdesk_reconcile_candidate_page(text,integer,text) from public,anon,authenticated;
grant execute on function public.clickdesk_reconcile_candidate_page(text,integer,text) to service_role;

create schema if not exists clickdesk_recovery_private;
revoke all on schema clickdesk_recovery_private from public,anon,authenticated;
create table if not exists clickdesk_recovery_private.reconcile_nov_supervisor (
 period_key text primary key check(period_key='2026-11'),
 phase text not null default 'running' check(phase in('running','complete','stopped')),
 cursor_value text not null default '',
 created_at timestamptz not null default clock_timestamp(),
 deadline_at timestamptz not null default clock_timestamp()+interval '48 hours',
 dispatches integer not null default 0 check(dispatches between 0 and 6000),
 completed_batches integer not null default 2,
 examined bigint not null default 24,
 confirmed bigint not null default 1,
 pending bigint not null default 23,
 last_request_id bigint,
 last_dispatch_at timestamptz,
 response_checked boolean not null default true,
 last_http_status integer,
 inventory_snapshot_hash text not null,
 inventory_snapshot_count bigint not null check(inventory_snapshot_count=21442),
 finished_at timestamptz,
 stop_reason text,
 check(examined=confirmed+pending)
);
alter table clickdesk_recovery_private.reconcile_nov_supervisor enable row level security;
revoke all on clickdesk_recovery_private.reconcile_nov_supervisor from public,anon,authenticated;
-- Frozen source verification. Starting at an empty cursor safely includes IDs that
-- arrived below 1015018 during discovery; the RPC skips the 24 already checked rows.
-- The initial counters still include those 24 (1 confirmed, 23 pending).
do $$
declare n bigint; h text; st text;
begin
 select status into st from public.clickdesk_period_inventory where period_key='2026-11';
 select count(*),md5(coalesce(string_agg(i.ticket_id||'|'||i.source_updated_at::text,E'\n' order by i.ticket_id collate "C"),''))
 into n,h from public.clickdesk_period_inventory_candidates i where i.period_key='2026-11';
 if st is distinct from 'complete' or n<>21442 then
   raise exception 'Expected completed November inventory with 21442 candidates';
 end if;
 insert into clickdesk_recovery_private.reconcile_nov_supervisor(period_key,inventory_snapshot_hash,inventory_snapshot_count)
 values('2026-11',h,n) on conflict(period_key) do nothing;
end;
$$;

create or replace function clickdesk_recovery_private.stop_reconcile_nov(p_reason text,p_complete boolean default false)
returns void language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare jid bigint;
begin
 update clickdesk_recovery_private.reconcile_nov_supervisor set
   phase=case when p_complete then 'complete' else 'stopped' end,
   finished_at=coalesce(finished_at,clock_timestamp()),stop_reason=coalesce(stop_reason,p_reason)
 where period_key='2026-11';
 for jid in select jobid from cron.job where jobname='clickdesk-reconcile-nov-2026-supervisor'
   and database=current_database() and username=current_user
 loop perform cron.unschedule(jid); end loop;
end;
$$;
revoke all on function clickdesk_recovery_private.stop_reconcile_nov(text,boolean) from public,anon,authenticated;

create or replace function clickdesk_recovery_private.tick_reconcile_nov()
returns void language plpgsql security invoker set search_path='' set timezone='UTC' as $$
declare
 c clickdesk_recovery_private.reconcile_nov_supervisor%rowtype;
 inventory_status text;
 inventory_hash text;
 payload jsonb;
 response_body text;
 http_status integer;
 timed_out boolean;
 n integer;
 n_confirmed integer;
 n_pending integer;
 more boolean;
 next_value text;
 parse_failure boolean:=false;
 token text;
 request_id bigint;
begin
 if not pg_try_advisory_xact_lock(202611,2315) then return; end if;
 select * into c from clickdesk_recovery_private.reconcile_nov_supervisor
 where period_key='2026-11' for update;
 if not found then return; end if;
 if c.phase in('complete','stopped') then
   perform clickdesk_recovery_private.stop_reconcile_nov(coalesce(c.stop_reason,'already_stopped'),c.phase='complete');return;
 end if;
 if clock_timestamp()>=c.deadline_at then
   perform clickdesk_recovery_private.stop_reconcile_nov('deadline_48h');return;
 end if;
 select i.status into inventory_status from public.clickdesk_period_inventory i where i.period_key='2026-11';
 if inventory_status is distinct from 'complete' then
   perform clickdesk_recovery_private.stop_reconcile_nov('inventory_not_complete');return;
 end if;

 if not c.response_checked then
   select r.status_code,r.timed_out,r.content into http_status,timed_out,response_body
   from net._http_response r where r.id=c.last_request_id;
   if not found then
     if clock_timestamp()>=c.last_dispatch_at+interval '360 seconds' then
       perform clickdesk_recovery_private.stop_reconcile_nov('request_response_timeout');
     end if;
     return;
   end if;
   update clickdesk_recovery_private.reconcile_nov_supervisor set last_http_status=http_status
   where period_key='2026-11';
   if http_status is distinct from 200 or coalesce(timed_out,false) then
     perform clickdesk_recovery_private.stop_reconcile_nov('reconcile_http_failure');return;
   end if;
   -- Only the minimal counters/cursor are retained. No headers, secret or customer content.
   begin
     payload:=response_body::jsonb;
     if payload->>'period' is distinct from '2026-11'
       or payload->>'mode' is distinct from 'persisted_homologation'
       or payload->>'source' is distinct from 'period_inventory_candidates'
       or jsonb_typeof(payload->'has_more') is distinct from 'boolean'
       or jsonb_typeof(payload->'examined') is distinct from 'number'
       or jsonb_typeof(payload->'confirmed') is distinct from 'number'
       or jsonb_typeof(payload->'pending') is distinct from 'number'
       or payload->>'examined' !~ '^[0-9]+$'
       or payload->>'confirmed' !~ '^[0-9]+$'
       or payload->>'pending' !~ '^[0-9]+$' then
       parse_failure:=true;
     else
       n:=(payload->>'examined')::integer;
       n_confirmed:=(payload->>'confirmed')::integer;
       n_pending:=(payload->>'pending')::integer;
       more:=(payload->>'has_more')::boolean;
       next_value:=payload->>'next_cursor';
       if n<0 or n>12 or n_confirmed+n_pending<>n then parse_failure:=true;
       elsif n=0 then
         if more or next_value is not null then parse_failure:=true;end if;
       elsif jsonb_typeof(payload->'next_cursor') is distinct from 'string'
         or next_value is null or length(next_value)>80
         or next_value collate "C"<=c.cursor_value collate "C" then parse_failure:=true;
       end if;
     end if;
   exception when others then parse_failure:=true;
   end;
   if parse_failure then perform clickdesk_recovery_private.stop_reconcile_nov('invalid_success_response');return;end if;
   -- Persist acknowledgement/cursor BEFORE enqueueing another request. A later enqueue
   -- failure stops the job without rolling back this successful batch's checkpoint.
   update clickdesk_recovery_private.reconcile_nov_supervisor set
     cursor_value=coalesce(next_value,cursor_value),response_checked=true,
     completed_batches=completed_batches+1,examined=examined+n,
     confirmed=confirmed+n_confirmed,pending=pending+n_pending
   where period_key='2026-11' returning * into c;
   if not more then
     select md5(coalesce(string_agg(i.ticket_id||'|'||i.source_updated_at::text,E'\n' order by i.ticket_id collate "C"),''))
     into inventory_hash from public.clickdesk_period_inventory_candidates i where i.period_key='2026-11';
     if inventory_hash is distinct from c.inventory_snapshot_hash then
       perform clickdesk_recovery_private.stop_reconcile_nov('inventory_changed_during_verification');return;
     end if;
     perform clickdesk_recovery_private.stop_reconcile_nov('frozen_snapshot_exhausted_partial_coverage',true);return;
   end if;
 end if;

 if c.dispatches>=6000 or c.examined>=50000 then
   perform clickdesk_recovery_private.stop_reconcile_nov('batch_or_examined_limit');return;
 end if;
 -- The only place that enqueues work is after every earlier response was acknowledged.
 begin
   select decrypted_secret into strict token from vault.decrypted_secrets where name='cx360_worker_token';
   if nullif(token,'') is null then raise exception 'missing credential';end if;
   select net.http_post(
     url:='https://painel-telefone.vercel.app/api/clickdesk/reconcile',
     headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
     body:=jsonb_build_object('period','2026-11','cursor',c.cursor_value,'limit',12,'dry_run',false),
     timeout_milliseconds:=300000
   ) into request_id;
   token:=null;
   if request_id is null then raise exception 'enqueue failed';end if;
 exception when others then
   perform clickdesk_recovery_private.stop_reconcile_nov('dispatch_enqueue_failed');return;
 end;
 update clickdesk_recovery_private.reconcile_nov_supervisor set
   last_request_id=request_id,last_dispatch_at=clock_timestamp(),response_checked=false,dispatches=dispatches+1
 where period_key='2026-11';
end;
$$;
revoke all on function clickdesk_recovery_private.tick_reconcile_nov() from public,anon,authenticated;
do $$
begin
 if exists(select 1 from clickdesk_recovery_private.reconcile_nov_supervisor
   where period_key='2026-11' and phase not in('complete','stopped') and deadline_at>clock_timestamp()) then
   perform cron.schedule('clickdesk-reconcile-nov-2026-supervisor','* * * * *',
     'select clickdesk_recovery_private.tick_reconcile_nov();');
 end if;
end;
$$;
commit;
-- Safe status: select * from clickdesk_recovery_private.reconcile_nov_supervisor;
-- No secret or response payload is stored in this status row.



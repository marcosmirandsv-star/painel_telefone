-- Append-only final source reread. Original failed jobs/tasks are never rewritten.
alter table public.clickdesk_official_capture_jobs add column source_parent_job_id uuid references public.clickdesk_official_capture_jobs(id);
alter table public.clickdesk_capture_investigations add column recovered_by_job_id uuid references public.clickdesk_official_capture_jobs(id);
create table public.clickdesk_capture_group_rechecks(
 job_id uuid not null references public.clickdesk_official_capture_jobs(id),
 attempt integer not null check(attempt between 1 and 2),
 period_start date not null,period_end date not null,
 request_id bigint not null,requested_at timestamptz not null default now(),
 checked_at timestamptz,group_payload jsonb,
 status text not null default 'pending' check(status in('pending','running','rejected','published','failed')),
 error_code text,retry_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,
 successor_job_id uuid references public.clickdesk_official_capture_jobs(id),
 primary key(job_id,attempt)
);
alter table public.clickdesk_capture_group_rechecks enable row level security;
revoke all on public.clickdesk_capture_group_rechecks from public,anon,authenticated;
grant select on public.clickdesk_capture_group_rechecks to authenticated;
grant select,insert,update on public.clickdesk_capture_group_rechecks to service_role;
create policy group_rechecks_management on public.clickdesk_capture_group_rechecks for select to authenticated using((select public.is_management_user()));
create policy group_rechecks_worker on public.clickdesk_capture_group_rechecks for all to service_role using(true)with check(true);

-- Vault and pg_net access is isolated here; no arbitrary URL/header/body parameters.
create function public.queue_clickdesk_group_recheck(p_job_id uuid)returns boolean
language plpgsql security definer set search_path='' as $$
declare j record;n integer;path text;request bigint;begin
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_group_recheck:'||p_job_id::text,0));
 select * into j from public.clickdesk_official_capture_jobs where id=p_job_id;
 if not found or j.status<>'failed' or j.source_parent_job_id is not null or j.started_at is null or j.started_at<clock_timestamp()-interval '30 minutes'
 or exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status<>'complete')
 or exists(select 1 from public.clickdesk_official_capture_jobs newer where newer.period_start=j.period_start and newer.period_end=j.period_end and newer.created_at>j.created_at)
 then return false;end if;
 if exists(select 1 from public.clickdesk_capture_group_rechecks r where r.job_id=j.id and(r.status in('pending','running','published')or r.retry_at>clock_timestamp()))then return false;end if;
 select count(*)+1 into n from public.clickdesk_capture_group_rechecks where job_id=j.id;
 if n>2 then return false;end if;
 select t.path into path from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.task_key='group';
 if path is null or path not like '/support/reports/agents?%'then return false;end if;
 request:=net.http_get(url:='https://api.desk.click.app/api/v1'||path,
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_api_key' limit 1),
 'X-Account-Id',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_account_id' limit 1),'Accept','application/json','Cache-Control','no-cache'),timeout_milliseconds:=65000);
 insert into public.clickdesk_capture_group_rechecks(job_id,attempt,period_start,period_end,request_id)values(j.id,n,j.period_start,j.period_end,request);
 return true;
end $$;
revoke all on function public.queue_clickdesk_group_recheck(uuid)from public,anon,authenticated;
grant execute on function public.queue_clickdesk_group_recheck(uuid)to service_role;

create function public.on_clickdesk_capture_failed_recheck()returns trigger language plpgsql security invoker set search_path='' as $$
begin if new.status='failed'and old.status is distinct from new.status then perform public.queue_clickdesk_group_recheck(new.id);end if;return new;end $$;
revoke all on function public.on_clickdesk_capture_failed_recheck()from public,anon,authenticated;
create trigger clickdesk_recheck_failed_capture after update of status on public.clickdesk_official_capture_jobs for each row execute function public.on_clickdesk_capture_failed_recheck();

create function public.claim_clickdesk_group_recheck()returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r record;resp record;j record;payload jsonb;token uuid:=gen_random_uuid();retry integer;begin
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_group_recheck_capacity',0));
 -- One preflight/publication at a time; expired workers cannot later overwrite it.
 if exists(select 1 from public.clickdesk_capture_group_rechecks where status='running'and lease_until>clock_timestamp())then return null;end if;
 update public.clickdesk_capture_group_rechecks set status='failed',error_code='recheck_lease_expired',retry_at=clock_timestamp()+interval '1 minute',lease_token=null,lease_until=null where status='running'and lease_until<=clock_timestamp();
 for j in select * from public.clickdesk_official_capture_jobs where status='failed'and source_parent_job_id is null and started_at>clock_timestamp()-interval '30 minutes' order by created_at desc limit 5 loop
  perform public.queue_clickdesk_group_recheck(j.id);
 end loop;
 select * into r from public.clickdesk_capture_group_rechecks where status='pending'order by requested_at for update skip locked limit 1;
 if not found then return null;end if;
 select * into j from public.clickdesk_official_capture_jobs where id=r.job_id;
 if j.status<>'failed'or j.started_at<clock_timestamp()-interval '30 minutes'
 or exists(select 1 from public.clickdesk_official_capture_jobs newer where newer.period_start=j.period_start and newer.period_end=j.period_end and newer.created_at>j.created_at)
 then update public.clickdesk_capture_group_rechecks set status='failed',error_code='recheck_superseded_or_stale'where job_id=r.job_id and attempt=r.attempt;return null;end if;
 select * into resp from net._http_response where id=r.request_id;
 if not found then return null;end if;
 if resp.status_code is distinct from 200 then
  retry:=60;
  if resp.status_code=429 then begin retry:=greatest(60,least(600,(resp.content::jsonb->>'retry_after')::integer));exception when others then retry:=60;end;end if;
  update public.clickdesk_capture_group_rechecks set status='failed',error_code='source_http_'||coalesce(resp.status_code::text,'unavailable'),retry_at=clock_timestamp()+make_interval(secs=>retry)where job_id=r.job_id and attempt=r.attempt;
  return null;
 end if;
 begin payload:=resp.content::jsonb;exception when others then
  update public.clickdesk_capture_group_rechecks set status='failed',error_code='invalid_source_json',retry_at=clock_timestamp()+interval '1 minute'where job_id=r.job_id and attempt=r.attempt;return null;end;
 if jsonb_typeof(payload)is distinct from 'object' or octet_length(payload::text)>1000000 then
  update public.clickdesk_capture_group_rechecks set status='failed',error_code='invalid_source_group',retry_at=clock_timestamp()+interval '1 minute'where job_id=r.job_id and attempt=r.attempt;return null;end if;
 update public.clickdesk_capture_group_rechecks set status='running',group_payload=payload,checked_at=clock_timestamp(),lease_token=token,lease_until=clock_timestamp()+interval '90 seconds'where job_id=r.job_id and attempt=r.attempt;
 return jsonb_build_object('id',j.id,'start',j.period_start,'end',j.period_end,'owners',to_jsonb(j.owners),'token',token,'attempt',r.attempt,'group',payload,
 'parts',(select jsonb_object_agg(t.task_key,t.payload)from public.clickdesk_official_capture_tasks t where t.job_id=j.id));
end $$;

create function public.reject_clickdesk_group_recheck(p_job_id uuid,p_attempt integer,p_token uuid)returns boolean
language plpgsql security invoker set search_path='' as $$
begin update public.clickdesk_capture_group_rechecks set status='rejected',error_code='source_still_not_reconciled',retry_at=clock_timestamp()+interval '1 minute',lease_token=null,lease_until=null
 where job_id=p_job_id and attempt=p_attempt and status='running'and lease_token=p_token and lease_until>clock_timestamp();return found;end $$;

create function public.publish_clickdesk_rechecked_capture(p_job_id uuid,p_attempt integer,p_token uuid,p_rows jsonb,p_votes jsonb)returns uuid
language plpgsql security invoker set search_path='' as $$
declare r record;j record;successor uuid;begin
 select * into r from public.clickdesk_capture_group_rechecks where job_id=p_job_id and attempt=p_attempt for update;
 if not found or r.lease_token is distinct from p_token then return null;end if;
 if r.status='published'then return r.successor_job_id;end if;
 if r.status<>'running'or r.lease_until<=clock_timestamp()then return null;end if;
 select * into j from public.clickdesk_official_capture_jobs where id=p_job_id for update;
 if j.status<>'failed'or j.started_at<clock_timestamp()-interval '30 minutes'then raise exception 'recheck_source_stale';end if;
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture:'||j.period_start::text||':'||j.period_end::text,0));
 if exists(select 1 from public.clickdesk_official_capture_jobs newer where newer.period_start=j.period_start and newer.period_end=j.period_end and newer.created_at>j.created_at)then raise exception 'recheck_source_superseded';end if;
 if r.group_payload->'range' is distinct from(select payload->'range'from public.clickdesk_official_capture_tasks where job_id=j.id and task_key='group')then raise exception 'recheck_period_changed';end if;
 -- Validate the new header and all untouched source parts through the same publisher.
 -- Inherit the original start time: a reread never renews the 30 minute capture budget.
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners,status,started_at,source_parent_job_id)
 values(j.period_start,j.period_end,j.owners,'running',j.started_at,j.id)returning id into successor;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path,status,attempts,payload,completed_at)
 select successor,t.task_key,t.path,'complete',t.attempts,case when t.task_key='group'then r.group_payload else t.payload end,
 case when t.task_key='group'then r.checked_at else t.completed_at end from public.clickdesk_official_capture_tasks t where t.job_id=j.id;
 if public.finalize_clickdesk_capture(successor,p_rows,p_votes)is distinct from true then raise exception 'recheck_publication_rejected';end if;
 update public.clickdesk_capture_group_rechecks set status='published',successor_job_id=successor where job_id=r.job_id and attempt=r.attempt;
 update public.clickdesk_capture_investigations set recovered_by_job_id=successor where job_id=j.id;
 return successor;
end $$;

revoke all on function public.claim_clickdesk_group_recheck()from public,anon,authenticated;
revoke all on function public.reject_clickdesk_group_recheck(uuid,integer,uuid)from public,anon,authenticated;
revoke all on function public.publish_clickdesk_rechecked_capture(uuid,integer,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.claim_clickdesk_group_recheck()to service_role;
grant execute on function public.reject_clickdesk_group_recheck(uuid,integer,uuid)to service_role;
grant execute on function public.publish_clickdesk_rechecked_capture(uuid,integer,uuid,jsonb,jsonb)to service_role;

-- Existing worker queues usually drive this. This covers a reread after other queues drain.
select cron.schedule('clickdesk-final-group-recheck','* * * * *',$command$
 select net.http_post(url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-official-metrics-sync',
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token'limit 1),'Content-Type','application/json'),body:='{"action":"work"}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.clickdesk_capture_group_rechecks where status in('pending','running'))
 or exists(select 1 from public.clickdesk_capture_group_rechecks r join public.clickdesk_official_capture_jobs j on j.id=r.job_id
  where r.status in('rejected','failed')and r.attempt=1 and r.retry_at<=now()and j.started_at>now()-interval '30 minutes'
  and not exists(select 1 from public.clickdesk_capture_group_rechecks newer where newer.job_id=r.job_id and newer.attempt>r.attempt)
  and not exists(select 1 from public.clickdesk_official_capture_jobs newer where newer.period_start=j.period_start and newer.period_end=j.period_end and newer.created_at>j.created_at));
$command$);

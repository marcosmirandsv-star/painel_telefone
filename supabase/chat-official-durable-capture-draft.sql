-- Applied ONLY to HML vvtorcvchnqhcredhorv as chat_official_durable_capture_20261116. Do not reapply. Changes after this baseline use additive migrations.
-- Separate staging keeps original ratings, approved reviews and closures untouched.
create table if not exists public.clickdesk_official_capture_jobs (
 id uuid primary key default gen_random_uuid(),
 period_start date not null,
 period_end date not null,
 owners integer[] not null,
 status text not null default 'pending' check(status in ('pending','running','publishing','published','failed')),
 created_at timestamptz not null default now(),
 published_at timestamptz,
 check(period_start<=period_end and date_trunc('month',period_start)=date_trunc('month',period_end)),
 check(cardinality(owners)>0)
);
create unique index if not exists clickdesk_official_one_live_capture
 on public.clickdesk_official_capture_jobs(period_start,period_end)
 where status in ('pending','running','publishing');
create table if not exists public.clickdesk_official_capture_tasks (
 job_id uuid not null references public.clickdesk_official_capture_jobs(id),
 task_key text not null,
 path text not null,
 status text not null default 'pending' check(status in ('pending','running','complete','failed')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 payload jsonb,
 completed_at timestamptz,
 error_code text,
 primary key(job_id,task_key),
 check(path like '/support/reports/agents?%' or path like '/support/reports/ratings?%'),
 check((status='complete')=(payload is not null))
);
alter table public.clickdesk_official_capture_jobs enable row level security;
alter table public.clickdesk_official_capture_tasks enable row level security;
revoke all on public.clickdesk_official_capture_jobs,public.clickdesk_official_capture_tasks from public,anon,authenticated;
grant select,insert,update on public.clickdesk_official_capture_jobs,public.clickdesk_official_capture_tasks to service_role;

create or replace function public.claim_clickdesk_capture_unit()
returns table(job_id uuid,task_key text,path text,lease_token uuid,attempt integer)
language plpgsql security invoker set search_path='' as $$
declare selected_job uuid; selected_key text; claim_token uuid := gen_random_uuid();
begin
 if not pg_try_advisory_xact_lock(hashtextextended('clickdesk_capture_claim_capacity',0)) then return;end if;
 if (select count(*) from public.clickdesk_official_capture_tasks t where t.status='running' and t.lease_until>clock_timestamp())>=4 then return;end if;
 select j.id into selected_job from public.clickdesk_official_capture_jobs j
 where j.status in ('pending','running') and exists(
 select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and
 (t.status='failed' or (t.status='pending' and t.next_attempt_at<=clock_timestamp())
 or (t.status='running' and t.lease_until<=clock_timestamp())))
 order by j.created_at,j.id for update of j skip locked limit 1;
 if not found then return;end if;
 if exists(select 1 from public.clickdesk_official_capture_jobs j where j.id=selected_job and j.created_at<clock_timestamp()-interval '30 minutes') then
 update public.clickdesk_official_capture_jobs j set status='failed' where j.id=selected_job;return;end if;
 update public.clickdesk_official_capture_tasks t
 set status='failed',lease_token=null,lease_until=null,error_code='capture_retry_exhausted'
 where t.job_id=selected_job and t.status='running' and t.lease_until<=clock_timestamp() and t.attempts>=5;
 if exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=selected_job and t.status='failed') then
 update public.clickdesk_official_capture_jobs j set status='failed' where j.id=selected_job;
 return;end if;
 select t.task_key into selected_key from public.clickdesk_official_capture_tasks t
 where t.job_id=selected_job and t.attempts<5 and
 ((t.status='pending' and t.next_attempt_at<=clock_timestamp()) or
 (t.status='running' and t.lease_until<=clock_timestamp()))
 order by t.task_key for update of t skip locked limit 1;
 if not found then return;end if;
 update public.clickdesk_official_capture_jobs j set status='running' where j.id=selected_job;
 return query update public.clickdesk_official_capture_tasks t
 set status='running',attempts=t.attempts+1,lease_token=claim_token,
 lease_until=clock_timestamp()+interval '90 seconds',error_code=null
 where t.job_id=selected_job and t.task_key=selected_key
 returning t.job_id,t.task_key,t.path,t.lease_token,t.attempts;
end $$;

create or replace function public.complete_clickdesk_capture_unit(
 p_job_id uuid,p_key text,p_token uuid,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed record; pages integer; page_number integer;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_capture_payload';end if;
 perform 1 from public.clickdesk_official_capture_jobs j
 where j.id=p_job_id and j.status='running' for update;
 if not found then return false;end if;
 select t.path into claimed from public.clickdesk_official_capture_tasks t
 where t.job_id=p_job_id and t.task_key=p_key and t.status='running'
 and t.lease_token=p_token and t.lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 if p_key like 'ratings:%' then
  if jsonb_typeof(p_payload->'data') is distinct from 'array'
   or coalesce(p_payload->>'last_page','') !~ '^[0-9]{1,3}$'
   or coalesce(p_payload->>'total','') !~ '^[0-9]{1,9}$'
  then raise exception 'invalid_capture_pagination';end if;
  pages:=(p_payload->>'last_page')::integer;
  if pages<1 or pages>500 or jsonb_array_length(p_payload->'data')>100
  then raise exception 'invalid_capture_pagination';end if;
  if p_key ~ '^ratings:(3|12):1$' and pages>1 then
   for page_number in 2..pages loop
    insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
    values(p_job_id,regexp_replace(p_key,':1$',':'||page_number::text),
     regexp_replace(claimed.path,'([?&]page=)1$', '\1'||page_number::text))
    on conflict(job_id,task_key) do nothing;
   end loop;
  end if;
 end if;
 update public.clickdesk_official_capture_tasks t
 set status='complete',payload=p_payload,completed_at=clock_timestamp(),lease_token=null,lease_until=null
 where t.job_id=p_job_id and t.task_key=p_key;
 return true;
end $$;

create or replace function public.retry_clickdesk_capture_unit(
 p_job_id uuid,p_key text,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare accepted integer;
begin
 perform 1 from public.clickdesk_official_capture_jobs j where j.id=p_job_id and j.status='running' for update;
 if not found then return false;end if;
 update public.clickdesk_official_capture_tasks t
 set status=case when t.attempts>=5 then 'failed' else 'pending' end,
 next_attempt_at=clock_timestamp()+make_interval(secs=>30*power(2,t.attempts-1)::integer),
 lease_token=null,lease_until=null,error_code='capture_unit_failed'
 where t.job_id=p_job_id and t.task_key=p_key and t.status='running'
 and t.lease_token=p_token and t.lease_until>clock_timestamp()
 and exists(select 1 from public.clickdesk_official_capture_jobs j where j.id=t.job_id and j.status='running');
 get diagnostics accepted=row_count;
 return accepted=1;
end $$;
revoke all on function public.claim_clickdesk_capture_unit() from public,anon,authenticated;
revoke all on function public.complete_clickdesk_capture_unit(uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.retry_clickdesk_capture_unit(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_clickdesk_capture_unit() to service_role;
grant execute on function public.complete_clickdesk_capture_unit(uuid,text,uuid,jsonb) to service_role;
grant execute on function public.retry_clickdesk_capture_unit(uuid,text,uuid) to service_role;

-- Creates the plan in one transaction; callers cannot supply arbitrary source paths.
create or replace function public.enqueue_clickdesk_capture(p_start date,p_end date,p_owners integer[])
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing_id uuid; created_id uuid; owner_id integer; department integer; base_query text; owner_query text;
begin
 if p_start is null or p_end is null or p_start>p_end
 or date_trunc('month',p_start)<>date_trunc('month',p_end)
 or p_end>(clock_timestamp() at time zone 'America/Sao_Paulo')::date
 or coalesce(cardinality(p_owners),0)=0
 or exists(select 1 from unnest(p_owners) x where x is null or x<=0)
 or cardinality(p_owners)<>(select count(distinct x) from unnest(p_owners) x)
 then raise exception 'invalid_capture_plan';end if;
 if exists(select 1 from unnest(p_owners) x where not exists(
  select 1 from public.clickdesk_official_owner_registry r
  where r.clickdesk_owner_id=x and r.active and r.source_scope='suporte_erp_fiscal'
  and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77)))
 or cardinality(p_owners)<>(select count(*) from public.clickdesk_official_owner_registry r
 where r.active and r.source_scope='suporte_erp_fiscal'
 and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77))
 then raise exception 'capture_roster_changed';end if;
 -- Serialize only enqueue for this period. No network request is made under this lock.
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture:'||p_start::text||':'||p_end::text,0));
 update public.clickdesk_official_capture_jobs j set status='failed' where j.period_start=p_start and j.period_end=p_end and j.status in ('pending','running') and j.created_at<clock_timestamp()-interval '30 minutes';
 select j.id into existing_id from public.clickdesk_official_capture_jobs j
 where j.period_start=p_start and j.period_end=p_end and j.status in ('pending','running','publishing');
 if found then return existing_id;end if;
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners)
 values(p_start,p_end,p_owners) returning id into created_id;
 base_query:='from='||p_start::text||'&to='||p_end::text;
 select string_agg('&owner_ids%5B%5D='||x::text,'' order by x) into owner_query from unnest(p_owners) x;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
 values(created_id,'group','/support/reports/agents?'||base_query||'&department_ids%5B%5D=3&department_ids%5B%5D=12'||owner_query);
 foreach owner_id in array p_owners loop
  insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
  values(created_id,'owner:'||owner_id::text,'/support/reports/agents?'||base_query||'&department_ids%5B%5D=3&department_ids%5B%5D=12&owner_ids%5B%5D='||owner_id::text);
 end loop;
 foreach department in array array[3,12] loop
  insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
  values(created_id,'ratings:'||department::text||':1','/support/reports/ratings?'||base_query||'&department_id='||department::text||'&per_page=100&page=1');
 end loop;
 return created_id;
end $$;
revoke all on function public.enqueue_clickdesk_capture(date,date,integer[]) from public,anon,authenticated;
grant execute on function public.enqueue_clickdesk_capture(date,date,integer[]) to service_role;

-- Final gate and existing publisher execute in the same transaction.
create or replace function public.finalize_clickdesk_capture(p_job_id uuid,p_rows jsonb,p_votes jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare job record; source_owner record; metric jsonb; owner_payload jsonb; group_payload jsonb;
 department integer; first_page jsonb; expected_pages integer; expected_total integer; actual_pages integer; actual_total bigint;
begin
 select * into job from public.clickdesk_official_capture_jobs j where j.id=p_job_id for update;
 if not found then raise exception 'capture_job_missing';end if;
 if job.status='published' then return true;end if;
 if job.status<>'running' then return false;end if;
 if job.created_at<clock_timestamp()-interval '30 minutes' then
  update public.clickdesk_official_capture_jobs j set status='failed' where j.id=p_job_id;return false;end if;
 if exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.status<>'complete')
 then return false;end if;
 if (select count(*) from public.clickdesk_official_owner_registry r where r.active
 and r.source_scope='suporte_erp_fiscal' and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77))<>cardinality(job.owners)
 or exists(select 1 from unnest(job.owners) x where not exists(
 select 1 from public.clickdesk_official_owner_registry r where r.active and r.source_scope='suporte_erp_fiscal'
 and r.clickdesk_owner_id=x and x not in (1,12,21,26,57,59,61,77)))
 then raise exception 'capture_roster_changed';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_votes) is distinct from 'array'
 or jsonb_array_length(p_rows)<>cardinality(job.owners) then raise exception 'invalid_capture_output';end if;
 select t.payload into group_payload from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='group';
 if group_payload is null then raise exception 'capture_group_missing';end if;
 foreach department in array array[3,12] loop
  select t.payload into first_page from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='ratings:'||department::text||':1';
  if first_page is null then raise exception 'capture_page_missing';end if;
  expected_pages:=(first_page->>'last_page')::integer;expected_total:=(first_page->>'total')::integer;
  select count(*),coalesce(sum(jsonb_array_length(t.payload->'data')),0) into actual_pages,actual_total
  from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key like 'ratings:'||department::text||':%';
  if actual_pages<>expected_pages or actual_total<>expected_total
  or exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id
   and t.task_key like 'ratings:'||department::text||':%' and
   ((t.payload->>'last_page')::integer<>expected_pages or (t.payload->>'total')::integer<>expected_total))
  then raise exception 'capture_ratings_incomplete';end if;
 end loop;
 for source_owner in select r.* from public.clickdesk_official_owner_registry r where r.clickdesk_owner_id=any(job.owners) loop
  if (select count(*) from jsonb_array_elements(p_rows) x where x->>'source_owner_key'=source_owner.source_owner_key)<>1
  then raise exception 'capture_owner_output_missing';end if;
  select x into metric from jsonb_array_elements(p_rows) x where x->>'source_owner_key'=source_owner.source_owner_key;
  select t.payload into owner_payload from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='owner:'||source_owner.clickdesk_owner_id::text;
  if owner_payload is null or (metric->>'attendances')::integer is distinct from (owner_payload#>>'{summary,received,value}')::integer
  or metric->>'attendance_basis' is distinct from 'received'
  or metric->>'source_scope' is distinct from 'suporte_erp_fiscal'
  or (metric->>'period_start')::date is distinct from job.period_start
  or (metric->>'period_end')::date is distinct from job.period_end
  then raise exception 'capture_output_not_reconciled';end if;
 end loop;
 if (select sum((x->>'attendances')::integer) from jsonb_array_elements(p_rows) x)
 is distinct from (group_payload#>>'{summary,received,value}')::integer then raise exception 'received_counts_not_reconciled';end if;
 update public.clickdesk_official_capture_jobs j set status='publishing' where j.id=p_job_id;
 if public.publish_clickdesk_official_capture(p_rows,p_votes) is distinct from true then raise exception 'capture_publish_failed';end if;
 update public.clickdesk_official_capture_jobs j set status='published',published_at=clock_timestamp() where j.id=p_job_id;
 return true;
end $$;
revoke all on function public.finalize_clickdesk_capture(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finalize_clickdesk_capture(uuid,jsonb,jsonb) to service_role;

create or replace function public.load_clickdesk_ready_capture()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'start',j.period_start,'end',j.period_end,'owners',to_jsonb(j.owners),
 'parts',(select jsonb_object_agg(t.task_key,t.payload) from public.clickdesk_official_capture_tasks t where t.job_id=j.id))
 from public.clickdesk_official_capture_jobs j where j.status='running'
 and exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.task_key='group')
 and not exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status<>'complete')
 order by j.created_at,j.id limit 1;
$$;
revoke all on function public.load_clickdesk_ready_capture() from public,anon,authenticated;
grant execute on function public.load_clickdesk_ready_capture() to service_role;

create or replace function public.fail_clickdesk_capture_finalization(p_job_id uuid)
returns void language sql security invoker set search_path='' as $$
 update public.clickdesk_official_capture_jobs j set status='failed'
 where j.id=p_job_id and j.status='running'
 and not exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status<>'complete');
$$;
revoke all on function public.fail_clickdesk_capture_finalization(uuid) from public,anon,authenticated;
grant execute on function public.fail_clickdesk_capture_finalization(uuid) to service_role;

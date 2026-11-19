create table public.clickdesk_capture_cohort_proofs(
 job_id uuid not null references public.clickdesk_official_capture_jobs(id),cycle integer not null check(cycle between 1 and 2),
 verified_at timestamptz not null,source_parts jsonb not null,source_times jsonb not null,ticket_ids jsonb not null,
 successor_job_id uuid references public.clickdesk_official_capture_jobs(id),primary key(job_id,cycle)
);
alter table public.clickdesk_capture_cohort_proofs enable row level security;
revoke all on public.clickdesk_capture_cohort_proofs from public,anon,authenticated;
grant select on public.clickdesk_capture_cohort_proofs to authenticated;
grant select,insert,update on public.clickdesk_capture_cohort_proofs to service_role;
create policy cohort_proofs_management on public.clickdesk_capture_cohort_proofs for select to authenticated using((select public.is_management_user()));
create policy cohort_proofs_worker on public.clickdesk_capture_cohort_proofs for all to service_role using(true)with check(true);

create function public.publish_clickdesk_verified_cohort(p_job_id uuid,p_token uuid,p_rows jsonb,p_votes jsonb)returns uuid
language plpgsql security invoker set search_path='' as $$
declare a record;j record;v jsonb;parts jsonb;times jsonb;ids jsonb;successor uuid;owner integer;expected integer;proof_cycle integer;group_at timestamptz;begin
 select * into a from public.clickdesk_capture_investigations where job_id=p_job_id for update;
 if not found or a.status<>'running'or a.lease_token is distinct from p_token or a.lease_until<=clock_timestamp()then return null;end if;
 v:=a.state->'verification';proof_cycle:=(v->>'cycle')::integer;group_at:=(v->>'groupAt')::timestamptz;
 if a.state->>'phase'<>'verify'or v->>'stage'<>'publish'or proof_cycle not between 1 and 2 or group_at is null then raise exception 'cohort_proof_not_ready';end if;
 select successor_job_id into successor from public.clickdesk_capture_cohort_proofs where job_id=p_job_id and cycle=proof_cycle;
 if successor is not null then return successor;end if;
 select * into j from public.clickdesk_official_capture_jobs where id=p_job_id for update;
 if j.status<>'failed'or j.started_at is null or j.started_at<clock_timestamp()-interval '30 minutes'then raise exception 'cohort_source_stale';end if;
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture:'||j.period_start::text||':'||j.period_end::text,0));
 if exists(select 1 from public.clickdesk_official_period_metrics where period_start=j.period_start and period_end=j.period_end and captured_at>group_at)then raise exception 'cohort_source_superseded';end if;
 select jsonb_object_agg(task_key,payload),jsonb_object_agg(task_key,completed_at)into parts,times from public.clickdesk_official_capture_tasks where job_id=j.id and task_key not like 'ratings:%';
 parts:=parts||(v->'overrides');times:=times||(v->'times');ids:=a.state->'tickets';
 if jsonb_typeof(ids)is distinct from 'array'or(a.state->>'ownerIndex')::integer<>cardinality(j.owners)
 or jsonb_array_length(ids)<>(select count(distinct t->>'id')from jsonb_array_elements(ids)t)
 or exists(select 1 from jsonb_array_elements(ids)t where t->>'id'is null or t->>'owner'is null or t->>'department'is null or t->>'created_at'is null or(t->>'id')::bigint<=0 or not((t->>'owner')::integer=any(j.owners))or(t->>'department')::integer not in(3,12)
 or((t->>'created_at')::timestamptz at time zone 'America/Sao_Paulo')::date not between j.period_start and j.period_end)
 then raise exception 'cohort_ticket_witness_invalid';end if;
 if parts->'group'->'range'is distinct from(select payload->'range'from public.clickdesk_official_capture_tasks where job_id=j.id and task_key='group')then raise exception 'cohort_period_changed';end if;
 if exists(select 1 from jsonb_object_keys(parts)k where k<>'group'and k!~'^owner:[0-9]+$'and k!~'^ratings:(3|12):[0-9]+$')then raise exception 'invalid_cohort_source_key';end if;
 foreach owner in array j.owners loop
  select count(*)into expected from jsonb_array_elements(ids)t where(t->>'owner')::integer=owner;
  if(parts#>>array['owner:'||owner::text,'summary','received','value'])::integer is distinct from expected then raise exception 'cohort_owner_count_changed';end if;
 end loop;
 if(parts#>>'{group,summary,received,value}')::integer is distinct from jsonb_array_length(ids)then raise exception 'cohort_group_count_changed';end if;
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners,status,started_at,source_parent_job_id)
 values(j.period_start,j.period_end,j.owners,'running',j.started_at,j.id)returning id into successor;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path,status,attempts,payload,completed_at)
 select successor,k,case when k='group'then(select path from public.clickdesk_official_capture_tasks where job_id=j.id and task_key='group')
 when k like 'owner:%'then(select path from public.clickdesk_official_capture_tasks where job_id=j.id and task_key=k)
 else '/support/reports/ratings?from='||j.period_start::text||'&to='||j.period_end::text||'&department_id='||split_part(k,':',2)||'&per_page=100&page='||split_part(k,':',3)end,
 'complete',1,p,(times->>k)::timestamptz from jsonb_each(parts)as entries(k,p);
 if public.finalize_clickdesk_capture(successor,p_rows,p_votes)is distinct from true then raise exception 'cohort_publication_rejected';end if;
 insert into public.clickdesk_capture_cohort_proofs(job_id,cycle,verified_at,source_parts,source_times,ticket_ids,successor_job_id)values(j.id,proof_cycle,group_at,parts,times,ids,successor);
 -- Older in-flight collections cannot replace the newly verified snapshot later.
 update public.clickdesk_official_capture_jobs set status='failed'where period_start=j.period_start and period_end=j.period_end and id<>successor and status in('pending','running');
 update public.clickdesk_capture_investigations i set recovered_by_job_id=successor where exists(select 1 from public.clickdesk_official_capture_jobs c where c.id=i.job_id and c.period_start=j.period_start and c.period_end=j.period_end and c.status='failed');
 return successor;
end $$;
revoke all on function public.publish_clickdesk_verified_cohort(uuid,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.publish_clickdesk_verified_cohort(uuid,uuid,jsonb,jsonb)to service_role;

create function public.clickdesk_has_verification_work()returns boolean language sql stable security invoker set search_path=''as $$
 select exists(select 1 from public.clickdesk_capture_investigations i join public.clickdesk_official_capture_jobs j on j.id=i.job_id
 where i.status in('pending','running')and i.state->>'phase'in('owners','verify')and j.status='failed'and j.started_at>now()-interval '25 minutes');
$$;
revoke all on function public.clickdesk_has_verification_work()from public,anon,authenticated;
grant execute on function public.clickdesk_has_verification_work()to service_role;

-- Only pending/due investigations run; source HTTP backoff and exclusive leases still apply.
select cron.alter_job(job_id:=(select jobid from cron.job where jobname='clickdesk-capture-investigations'),schedule:='15 seconds');
CREATE OR REPLACE FUNCTION public.enqueue_clickdesk_capture(p_start date, p_end date, p_owners integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 -- Give an active verified-ID pass its original bounded freshness window.
 select j.id into existing_id from public.clickdesk_official_capture_jobs j join public.clickdesk_capture_investigations i on i.job_id=j.id
 where j.period_start=p_start and j.period_end=p_end and j.status='failed' and j.started_at>clock_timestamp()-interval '25 minutes'
 and i.status in('pending','running') and i.state->>'phase' in('owners','verify') and i.recovered_by_job_id is null
 and not exists(select 1 from public.clickdesk_official_capture_jobs newer where newer.period_start=p_start and newer.period_end=p_end and newer.created_at>j.created_at)
 order by j.created_at desc limit 1;
 if found then return existing_id;end if;

 update public.clickdesk_official_capture_jobs j set status='failed' where j.period_start=p_start and j.period_end=p_end and j.status in ('pending','running') and j.started_at<clock_timestamp()-interval '30 minutes';
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
end $function$


-- Reduce collection skew without increasing the two-request concurrency cap.
select cron.alter_job(job_id:=(select jobid from cron.job where jobname='clickdesk-official-durable-worker'),schedule:='15 seconds');

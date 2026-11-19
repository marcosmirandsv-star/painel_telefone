-- Read-only source investigations. Never changes captured payloads or publishes metrics.
create table public.clickdesk_capture_investigations (
 job_id uuid primary key references public.clickdesk_official_capture_jobs(id),
 period_start date not null,
 period_end date not null,
 status text not null default 'pending' check(status in('pending','running','explained','inconclusive')),
 state jsonb not null default '{}'::jsonb,
 result jsonb not null default '{}'::jsonb,
 attempts integer not null default 0,
 steps integer not null default 0,
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.clickdesk_capture_investigations enable row level security;
revoke all on public.clickdesk_capture_investigations from public,anon,authenticated;
grant select on public.clickdesk_capture_investigations to authenticated;
grant select,insert,update on public.clickdesk_capture_investigations to service_role;
create policy investigations_management_read on public.clickdesk_capture_investigations
 for select to authenticated using ((select public.is_management_user()));
create policy investigations_worker on public.clickdesk_capture_investigations
 for all to service_role using (true) with check (true);

create function public.queue_clickdesk_capture_investigation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='failed' and old.status is distinct from new.status then
  insert into public.clickdesk_capture_investigations(job_id,period_start,period_end) values(new.id,new.period_start,new.period_end) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function public.queue_clickdesk_capture_investigation() from public,anon,authenticated;
create trigger clickdesk_investigate_failed_capture after update of status
 on public.clickdesk_official_capture_jobs for each row execute function public.queue_clickdesk_capture_investigation();

create function public.claim_clickdesk_capture_investigation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare selected_id uuid; token uuid:=gen_random_uuid(); answer jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_investigation_capacity',0));
 if exists(select 1 from public.clickdesk_capture_investigations where status='running' and lease_until>clock_timestamp()) then return null;end if;
 update public.clickdesk_capture_investigations set status='inconclusive',lease_token=null,lease_until=null,
 result=jsonb_build_object('reason','investigation_budget_exhausted'),updated_at=clock_timestamp()
 where status in('pending','running') and (lease_until is null or lease_until<=clock_timestamp())
 and (steps>=150 or attempts>=5 or created_at<clock_timestamp()-interval '2 hours');
 select job_id into selected_id from public.clickdesk_capture_investigations
 where (status='pending' and next_attempt_at<=clock_timestamp()) or (status='running' and lease_until<=clock_timestamp())
 order by created_at,job_id for update skip locked limit 1;
 if not found then return null;end if;
 update public.clickdesk_capture_investigations set status='running',attempts=attempts+1,
 lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp()
 where job_id=selected_id returning jsonb_build_object('jobId',job_id,'token',lease_token,'attempt',attempts,'state',state) into answer;
 return answer;
end $$;

create function public.load_clickdesk_investigation_context(p_job_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'start',j.period_start,'end',j.period_end,'owners',to_jsonb(j.owners),
 'parts',(select jsonb_object_agg(t.task_key,t.payload) from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status='complete' and (t.task_key='group' or t.task_key like 'owner:%')),
 'times',(select jsonb_object_agg(t.task_key,t.completed_at) from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status='complete' and (t.task_key='group' or t.task_key like 'owner:%')),
 'registry',(select jsonb_agg(jsonb_build_object('id',r.clickdesk_owner_id,'name',r.source_owner_name)) from public.clickdesk_official_owner_registry r where r.active and r.source_scope='suporte_erp_fiscal'))
 from public.clickdesk_official_capture_jobs j where j.id=p_job_id and j.status='failed';
$$;

create function public.save_clickdesk_capture_investigation(p_job_id uuid,p_token uuid,p_state jsonb,p_result jsonb,p_status text,p_retry_seconds integer default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in('pending','explained','inconclusive') or p_retry_seconds not between 0 and 600
 or jsonb_typeof(p_state)<>'object' or jsonb_typeof(p_result)<>'object'
 or octet_length(p_state::text)>16000000 or octet_length(p_result::text)>1000000 then raise exception 'invalid_investigation_checkpoint';end if;
 update public.clickdesk_capture_investigations set state=p_state,result=p_result,status=p_status,
 attempts=case when p_retry_seconds>0 then attempts else 0 end,
 steps=steps+case when p_retry_seconds>0 then 0 else 1 end,
 next_attempt_at=clock_timestamp()+make_interval(secs=>p_retry_seconds),lease_token=null,lease_until=null,updated_at=clock_timestamp()
 where job_id=p_job_id and lease_token=p_token and status='running' and lease_until>clock_timestamp();
 return found;
end $$;

revoke all on function public.claim_clickdesk_capture_investigation() from public,anon,authenticated;
revoke all on function public.load_clickdesk_investigation_context(uuid) from public,anon,authenticated;
revoke all on function public.save_clickdesk_capture_investigation(uuid,uuid,jsonb,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.claim_clickdesk_capture_investigation() to service_role;
grant execute on function public.load_clickdesk_investigation_context(uuid) to service_role;
grant execute on function public.save_clickdesk_capture_investigation(uuid,uuid,jsonb,jsonb,text,integer) to service_role;
-- Investigate existing failures too, preserving their original tasks and publication state.
insert into public.clickdesk_capture_investigations(job_id,period_start,period_end)
 select id,period_start,period_end from public.clickdesk_official_capture_jobs where status='failed' on conflict do nothing;

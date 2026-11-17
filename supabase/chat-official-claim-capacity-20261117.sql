create or replace function public.claim_clickdesk_capture_unit()
returns table(job_id uuid,task_key text,path text,lease_token uuid,attempt integer)
language plpgsql security invoker set search_path='' as $$
declare selected_job uuid; selected_key text; claim_token uuid := gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture_claim_capacity',0));
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

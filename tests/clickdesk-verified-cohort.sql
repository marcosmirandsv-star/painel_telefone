-- Synthetic ticket witnesses and real source-shaped reports are fixtures only. All writes roll back.
begin;
do $$
declare parent uuid;child uuid;token uuid:=gen_random_uuid();parts jsonb;times jsonb;ids jsonb;rows jsonb;votes jsonb;fixture_state jsonb;before_hash text;stamp timestamptz;refused boolean;
begin
 if has_function_privilege('anon','public.publish_clickdesk_verified_cohort(uuid,uuid,jsonb,jsonb)','execute')or has_function_privilege('authenticated','public.publish_clickdesk_verified_cohort(uuid,uuid,jsonb,jsonb)','execute')then raise exception 'cohort worker privilege leaked';end if;
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners,status,started_at)
 select period_start,period_end,owners,'running',clock_timestamp()from public.clickdesk_official_capture_jobs where period_start='2026-10-01'and period_end='2026-10-31'and status='published'order by created_at desc limit 1 returning id into parent;
 if parent is null then raise exception 'published fixture unavailable';end if;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path,status,attempts,payload,completed_at)
 select parent,t.task_key,t.path,t.status,t.attempts,t.payload,t.completed_at from public.clickdesk_official_capture_tasks t where t.job_id=(select id from public.clickdesk_official_capture_jobs where period_start='2026-10-01'and period_end='2026-10-31'and status='published'order by created_at desc limit 1);
 select jsonb_object_agg(task_key,payload),jsonb_object_agg(task_key,completed_at),md5(jsonb_object_agg(task_key,payload)::text)into parts,times,before_hash from public.clickdesk_official_capture_tasks where job_id=parent;
 update public.clickdesk_official_capture_jobs set status='failed'where id=parent;
 stamp:=clock_timestamp();
 select jsonb_agg(jsonb_build_object('id',900000000+ordinal,'owner',owner_id,'department',3,'created_at','2026-10-15T12:00:00Z'))into ids
 from(select r.clickdesk_owner_id owner_id,row_number()over(order by r.clickdesk_owner_id,g.n)ordinal from public.clickdesk_official_period_metrics m join public.clickdesk_official_owner_registry r on r.source_owner_key=m.source_owner_key cross join lateral generate_series(1,m.attendances)g(n)where m.period_start='2026-10-01'and m.period_end='2026-10-31')w;
 select jsonb_agg(jsonb_set(v,'{captured_at}',to_jsonb(stamp::text))),a.votes into rows,votes from public.clickdesk_official_capture_audit a,jsonb_array_elements(a.metrics)v where a.id=(select max(id)from public.clickdesk_official_capture_audit where period_start='2026-10-01'and period_end='2026-10-31')group by a.id,a.votes;
 times:=jsonb_set(times,'{group}',to_jsonb(stamp));
 fixture_state:=jsonb_build_object('phase','verify','ownerIndex',15,'tickets',ids,'verification',jsonb_build_object('cycle',1,'stage','publish','groupAt',stamp,'overrides',parts,'times',times));
 update public.clickdesk_capture_investigations set status='running',lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',state=jsonb_set(fixture_state,'{tickets,0,owner}','999999')where job_id=parent;
 refused:=false;begin perform public.publish_clickdesk_verified_cohort(parent,token,rows,votes);exception when others then refused:=true;end;
 if not refused then raise exception 'invalid witness owner accepted';end if;
 update public.clickdesk_capture_investigations i set state=fixture_state where i.job_id=parent;
 if public.publish_clickdesk_verified_cohort(parent,gen_random_uuid(),rows,votes)is not null then raise exception 'bad lease accepted';end if;
 refused:=false;begin perform public.publish_clickdesk_verified_cohort(parent,token,jsonb_set(rows,'{0,attendances}',to_jsonb((rows->0->>'attendances')::integer+1)),votes);exception when others then refused:=true;end;
 if not refused then raise exception 'arithmetic metric override accepted';end if;
 child:=public.publish_clickdesk_verified_cohort(parent,token,rows,votes);
 if child is null then raise exception 'valid cohort rejected';end if;
 if(select status from public.clickdesk_official_capture_jobs where id=parent)<>'failed'then raise exception 'source job changed';end if;
 if before_hash is distinct from(select md5(jsonb_object_agg(task_key,payload)::text)from public.clickdesk_official_capture_tasks where job_id=parent)then raise exception 'source payload changed';end if;
 if not exists(select 1 from public.clickdesk_official_capture_jobs c join public.clickdesk_official_capture_jobs p on p.id=c.source_parent_job_id where c.id=child and p.id=parent and c.started_at=p.started_at and c.status='published')then raise exception 'lineage or deadline lost';end if;
 if public.publish_clickdesk_verified_cohort(parent,token,rows,votes)is distinct from child then raise exception 'cohort publication not idempotent';end if;
end $$;
rollback;
select jsonb_build_object('fixture_rolled_back',true,'invalid_witness_rejected',true,'arithmetic_override_rejected',true,'original_parts_preserved',true,'lineage_and_deadline_preserved',true,'idempotent',true)as verified;

-- Transactional integration fixture: no HTTP request or metric change survives rollback.
begin;
do $$
declare parent uuid;child uuid;claim jsonb;request bigint;source_group jsonb;rows jsonb;votes jsonb;before_hash text;after_hash text;accepted uuid;
begin
 if has_function_privilege('anon','public.queue_clickdesk_group_recheck(uuid)','execute')
 or has_function_privilege('authenticated','public.publish_clickdesk_rechecked_capture(uuid,integer,uuid,jsonb,jsonb)','execute')then raise exception 'worker privilege leaked';end if;
 if not(select relrowsecurity from pg_class where oid='public.clickdesk_capture_group_rechecks'::regclass)then raise exception 'missing RLS';end if;
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners,status,started_at)
 select period_start,period_end,owners,'running',clock_timestamp()from public.clickdesk_official_capture_jobs
 where period_start='2026-10-01'and period_end='2026-10-31'and status='published'order by created_at desc limit 1 returning id into parent;
 if parent is null then raise exception 'published fixture unavailable';end if;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path,status,attempts,payload,completed_at)
 select parent,t.task_key,t.path,t.status,t.attempts,t.payload,t.completed_at from public.clickdesk_official_capture_tasks t
 where t.job_id=(select id from public.clickdesk_official_capture_jobs where period_start='2026-10-01'and period_end='2026-10-31'and status='published'order by created_at desc limit 1);
 select md5(jsonb_object_agg(task_key,payload)::text)into before_hash from public.clickdesk_official_capture_tasks where job_id=parent;
 update public.clickdesk_official_capture_jobs set status='failed'where id=parent;
 select request_id into request from public.clickdesk_capture_group_rechecks where job_id=parent and attempt=1;
 if request is null then raise exception 'recheck not automatically queued';end if;
 select payload||jsonb_build_object('integration_fixture',true)into source_group from public.clickdesk_official_capture_tasks where job_id=parent and task_key='group';
 -- pg_net only starts requests at commit, so this response fixture cannot reach the source.
 insert into net._http_response(id,status_code,content_type,headers,content,created)values(request,200,'application/json','{}',source_group::text,now());
 claim:=public.claim_clickdesk_group_recheck();
 if claim->>'id' is distinct from parent::text then raise exception 'wrong fixture claim';end if;
 select jsonb_agg(jsonb_set(v,'{captured_at}',to_jsonb(now()::text))),a.votes into rows,votes
 from public.clickdesk_official_capture_audit a,jsonb_array_elements(a.metrics)v
 where a.id=(select max(id)from public.clickdesk_official_capture_audit where period_start='2026-10-01'and period_end='2026-10-31')group by a.id,a.votes;
 accepted:=public.publish_clickdesk_rechecked_capture(parent,1,gen_random_uuid(),rows,votes);
 if accepted is not null then raise exception 'wrong token accepted';end if;
 child:=public.publish_clickdesk_rechecked_capture(parent,1,(claim->>'token')::uuid,rows,votes);
 if child is null then raise exception 'valid recheck rejected';end if;
 if(select status from public.clickdesk_official_capture_jobs where id=parent)<>'failed'then raise exception 'original job changed';end if;
 select md5(jsonb_object_agg(task_key,payload)::text)into after_hash from public.clickdesk_official_capture_tasks where job_id=parent;
 if before_hash is distinct from after_hash then raise exception 'original payload changed';end if;
 if not exists(select 1 from public.clickdesk_official_capture_jobs c join public.clickdesk_official_capture_jobs p on p.id=c.source_parent_job_id
 where c.id=child and p.id=parent and c.started_at=p.started_at and c.status='published')then raise exception 'lineage or freshness lost';end if;
 if public.publish_clickdesk_rechecked_capture(parent,1,(claim->>'token')::uuid,rows,votes)is distinct from child then raise exception 'publication not idempotent';end if;
 if(select count(*)from public.clickdesk_official_capture_jobs where source_parent_job_id=parent)<>1 then raise exception 'duplicate successor';end if;
end $$;
rollback;
select jsonb_build_object('fixture_rolled_back',true,'original_job_and_payloads_preserved',true,'lineage_and_original_deadline_preserved',true,'wrong_token_rejected',true,'publication_idempotent',true,'public_worker_access',false)as verified;

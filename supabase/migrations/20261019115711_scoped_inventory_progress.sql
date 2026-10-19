
create or replace function public.get_clickdesk_360_queue_status(p_start date,p_end date,p_team uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.is_management_user() then raise exception 'Management only' using errcode='42501'; end if;
 if p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 return jsonb_build_object(
 'scope',jsonb_build_object('start',p_start,'end',p_end,'team_id',p_team),
 'counts',(select jsonb_build_object('pending',count(*) filter(where w.status='pending'),'processing',count(*) filter(where w.status='processing'),'failed',count(*) filter(where w.status='failed'),'done',count(*) filter(where w.status='done'))
 from public.clickdesk_360_work_queue w join public.chat_analysts a on a.id=w.analyst_id and a.active
 where w.occurred_date between p_start and p_end and (p_team is null or w.team_id=p_team)),
 'health',(select to_jsonb(h) from public.clickdesk_360_worker_health h where singleton),
 'failures',(select coalesce(jsonb_agg(f),'[]'::jsonb) from(
 select ticket_id,error_code,attempts,next_attempt_at from public.clickdesk_360_work_queue
 where status='failed' and occurred_date between p_start and p_end and (p_team is null or team_id=p_team)
 order by updated_at desc limit 20)f),
 'inventory',(select jsonb_build_object(
 'scope','all_teams_in_month','run',to_jsonb(r),
 'assessment',(select to_jsonb(a) from public.clickdesk_inventory_assessment a where a.period_key=r.period_key),
 'partitions',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.clickdesk_inventory_partitions where period_key=r.period_key group by status)p))
 from public.clickdesk_period_inventory r where r.period_key=to_char(p_start,'YYYY-MM')),
 'refreshed_at',now());
end $$;
revoke all on function public.get_clickdesk_360_queue_status(date,date,uuid) from public,anon;
grant execute on function public.get_clickdesk_360_queue_status(date,date,uuid) to authenticated,service_role;


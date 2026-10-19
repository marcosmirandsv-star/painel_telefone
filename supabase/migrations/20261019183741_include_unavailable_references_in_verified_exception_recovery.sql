create or replace function public.get_clickdesk_reconciliation_exceptions(p_limit integer default 24)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with failures as materialized (
 select p.ticket_id as id,coalesce(c.source_updated_at::text,'') version,coalesce(c.period_end::text,'') as "sourceDay",'capture'::text origin
 from clickdesk_final_ticket_pending p left join clickdesk_chat_capture_queue c using(ticket_id)
 where p.reason in('history_incomplete','history_read_failed','clickdesk_http_404')
), batch as (select * from failures order by id::numeric desc limit least(greatest(p_limit,1),32))
select jsonb_build_object('candidate_count',(select count(*) from clickdesk_chat_capture_queue),'backlog_before',(select count(*)from failures),'discovered_in_target_period',null,'candidates',coalesce((select jsonb_agg(to_jsonb(batch))from batch),'[]'::jsonb))
$$;
revoke all on function public.get_clickdesk_reconciliation_exceptions(integer) from public,anon,authenticated;
grant execute on function public.get_clickdesk_reconciliation_exceptions(integer) to service_role;
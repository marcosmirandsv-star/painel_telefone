create or replace function public.get_clickdesk_reconciliation_batch(p_limit integer default 24,p_refresh boolean default false,p_start date default null,p_end date default null)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with raw as (
 select ticket_id,source_updated_at as version,period_end as source_day,'capture'::text origin,false as in_scope from clickdesk_chat_capture_queue
 union all select clickdesk_ticket_id,updated_at,occurred_date,'legacy',occurred_date between p_start and p_end from clickdesk_chat_attendances
 union all select ticket_id,verified_at,occurred_date,'verified',occurred_date between p_start and p_end from clickdesk_chat_verified_contributions
), candidates as materialized (
 select distinct on(ticket_id) ticket_id,version,source_day,origin,bool_or(in_scope) over(partition by ticket_id) as in_scope
 from raw where ticket_id ~ '^[0-9]{1,25}$' order by ticket_id,version desc nulls last,(origin='verified') desc,source_day desc nulls last
), eligible as materialized (
 select c.* from candidates c left join clickdesk_final_ticket_ledger l using(ticket_id)
 left join clickdesk_final_ticket_pending p using(ticket_id)
 where (p_start is null or c.in_scope) and (
 p_refresh or (l.ticket_id is not null and c.version>l.verified_at)
 or (l.ticket_id is null and (p.ticket_id is null or c.version>p.checked_at
 or (p.reason='final_author_not_in_eligible_registry' and p.checked_at<(select changed_at from clickdesk_registry_revision where singleton))
 or (p.reason ~ '^(clickdesk_http_|history_read_failed|history_incomplete|deadline)' and p.checked_at<now()-interval '30 minutes'))))
), batch as (
 select ticket_id as id,coalesce(version::text,'') as version,coalesce(source_day::text,'') as "sourceDay",origin
 from eligible order by source_day desc nulls last,version desc nulls last,ticket_id::numeric desc limit least(greatest(p_limit,1),32)
)
select jsonb_build_object('candidate_count',(select count(*) from candidates),'backlog_before',(select count(*) from eligible),
 'discovered_in_target_period',case when p_start is null then null else (select count(*) from candidates where in_scope) end,
 'candidates',coalesce((select jsonb_agg(to_jsonb(batch)) from batch),'[]'::jsonb));
$$;
revoke all on function public.get_clickdesk_reconciliation_batch(integer,boolean,date,date) from public,anon,authenticated;
grant execute on function public.get_clickdesk_reconciliation_batch(integer,boolean,date,date) to service_role;
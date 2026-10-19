create or replace function public.get_clickdesk_metric_rows(p_start date,p_end date,p_analyst uuid default null,p_team uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 if exists(select 1 from public.clickdesk_final_ticket_ledger l where l.occurred_date between p_start and p_end
 and (p_analyst is null or l.analyst_id=p_analyst) and (p_team is null or l.team_id=p_team)
 and not exists(select 1 from public.chat_analysts a where a.id=l.analyst_id)) then raise exception 'Missing roster'; end if;
 return (
 with eligible as materialized (
 select l.*,a.name,a.active from public.clickdesk_final_ticket_ledger l join public.chat_analysts a on a.id=l.analyst_id
 where l.occurred_date between p_start and p_end and (p_analyst is null or l.analyst_id=p_analyst)
 and (p_team is null or l.team_id=p_team)
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=l.ticket_id)
 ), grouped as (
 select occurred_date,team_id,analyst_id,coalesce(area,'Fila histórica não comprovada') area,name assignee_name,
 'analyst'::text identity_role,count(*) attendances,
 count(*) filter(where satisfaction_label='positive') positive_reviews,
 count(*) filter(where satisfaction_label='negative') negative_reviews,
 count(*) filter(where satisfaction_label is not null) reviews,
 null::numeric csat,null::numeric review_percentage,min(ticket_id) first_ticket
 from eligible where p_analyst is not null or active
 group by occurred_date,team_id,analyst_id,area,name
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)-'first_ticket' order by first_ticket) from grouped g),'[]'::jsonb),
 'last_reconciled_at',(select max(verified_at) from eligible),
 'excludedInactive',(select case when p_analyst is null then count(*) filter(where not active) else 0 end from eligible))
 );
end $$;
revoke all on function public.get_clickdesk_metric_rows(date,date,uuid,uuid) from public,anon;
grant execute on function public.get_clickdesk_metric_rows(date,date,uuid,uuid) to authenticated;

create or replace function public.assess_clickdesk_period_inventory(p_period text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.clickdesk_period_inventory; result jsonb;
begin
 select * into r from public.clickdesk_period_inventory where period_key=p_period;
 if not found then return null; end if;
 with classified as (
 select c.ticket_id,c.source_updated_at,
 case
 when p.ticket_id is not null and p.checked_at>=c.source_updated_at then
 case when p.reason in ('no_public_human_answer','final_author_not_in_eligible_registry','final_author_apprentice') then 'excluded_'||p.reason else 'pending_'||p.reason end
 when l.ticket_id is not null and l.verified_at>=c.source_updated_at then 'confirmed'
 else 'pending_source_not_reconciled' end outcome,
 case when l.occurred_date between r.start_date and r.cutoff_date and a.active and p.ticket_id is null then 1 else 0 end included
 from public.clickdesk_period_inventory_candidates c
 left join public.clickdesk_final_ticket_ledger l on l.ticket_id=c.ticket_id
 left join public.chat_analysts a on a.id=l.analyst_id
 left join public.clickdesk_final_ticket_pending p on p.ticket_id=c.ticket_id
 where c.period_key=p_period
 ), counts as (
 select count(*)::int candidate_count,count(*) filter(where outcome='confirmed')::int confirmed_count,
 count(*) filter(where outcome like 'excluded_%')::int excluded_count,
 count(*) filter(where outcome like 'pending_%')::int pending_count,sum(included)::int included_period_count,
 md5(coalesce(string_agg(ticket_id||':'||source_updated_at::text||':'||outcome,'|' order by ticket_id),'')) source_hash
 from classified
 ), saved as (
 insert into public.clickdesk_inventory_assessment(period_key,candidate_count,confirmed_count,excluded_count,pending_count,included_period_count,reasons,source_hash,complete)
 select p_period,c.candidate_count,c.confirmed_count,c.excluded_count,c.pending_count,coalesce(c.included_period_count,0),
 coalesce((select jsonb_object_agg(outcome,n) from(select outcome,count(*) n from classified group by outcome)x),'{}'::jsonb),
 c.source_hash,r.status='complete' and c.pending_count=0 and c.candidate_count=c.confirmed_count+c.excluded_count
 and ((now() at time zone 'America/Sao_Paulo')::date<=r.end_date or (r.cutoff_date=r.end_date and (r.finished_at at time zone 'America/Sao_Paulo')::date>r.end_date)) from counts c
 on conflict(period_key) do update set candidate_count=excluded.candidate_count,confirmed_count=excluded.confirmed_count,excluded_count=excluded.excluded_count,
 pending_count=excluded.pending_count,included_period_count=excluded.included_period_count,reasons=excluded.reasons,source_hash=excluded.source_hash,complete=excluded.complete,assessed_at=now()
 returning *
 ) select to_jsonb(saved) into result from saved;
 insert into public.clickdesk_final_coverage(source_key,start_date,end_date,candidate_count,confirmed_count,pending_count,completeness,evidence_hash,verified_at)
 values('period_inventory_'||p_period,r.start_date,r.cutoff_date,(result->>'candidate_count')::int,(result->>'confirmed_count')::int,(result->>'pending_count')::int,
 case when (result->>'complete')::boolean then 'complete' else 'partial' end,result->>'source_hash',now())
 on conflict(source_key) do update set start_date=excluded.start_date,end_date=excluded.end_date,candidate_count=excluded.candidate_count,confirmed_count=excluded.confirmed_count,
 pending_count=excluded.pending_count,completeness=excluded.completeness,evidence_hash=excluded.evidence_hash,verified_at=excluded.verified_at;
 return result;
end $$;
revoke all on function public.assess_clickdesk_period_inventory(text) from public,anon,authenticated;
grant execute on function public.assess_clickdesk_period_inventory(text) to service_role;

alter table public.clickdesk_period_inventory_candidates
 add column last_public_at timestamptz,
 add column outside_period_verified_at timestamptz,
 add column outside_period_evidence_hash text;
alter table public.clickdesk_period_inventory_candidates add constraint outside_period_proof_complete check(
 (last_public_at is null and outside_period_verified_at is null and outside_period_evidence_hash is null)
 or(last_public_at is not null and outside_period_verified_at is not null and outside_period_evidence_hash ~ '^[a-f0-9]{64}$')
);
create function public.record_clickdesk_outside_period_proofs(p_period text,p_rows jsonb,p_hash text)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>128 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid period proof';end if;
 update public.clickdesk_period_inventory_candidates c
 set last_public_at=x.last_public_at,outside_period_verified_at=now(),outside_period_evidence_hash=p_hash
 from jsonb_to_recordset(p_rows)x(ticket_id text,last_public_at timestamptz,source_version timestamptz),public.clickdesk_period_inventory r
 where c.period_key=p_period and r.period_key=c.period_key and c.ticket_id=x.ticket_id
 and c.source_updated_at<=x.source_version
 and (x.last_public_at at time zone 'America/Sao_Paulo')::date<r.start_date
 and exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=c.ticket_id and p.reason='final_author_ambiguous');
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.record_clickdesk_outside_period_proofs(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_clickdesk_outside_period_proofs(text,jsonb,text)to service_role;
CREATE OR REPLACE FUNCTION public.assess_clickdesk_period_inventory(p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.clickdesk_period_inventory; result jsonb;
begin
 select * into r from public.clickdesk_period_inventory where period_key=p_period;
 if not found then return null; end if;
 with classified as (
 select c.ticket_id,c.source_updated_at,
 case
 when c.outside_period_verified_at>=c.source_updated_at and (c.last_public_at at time zone 'America/Sao_Paulo')::date<r.start_date then 'excluded_last_public_outside_period'
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
end $function$


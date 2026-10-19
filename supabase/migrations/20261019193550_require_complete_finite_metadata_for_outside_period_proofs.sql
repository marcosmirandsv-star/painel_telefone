alter table public.clickdesk_period_inventory_candidates drop constraint outside_period_proof_complete;
alter table public.clickdesk_period_inventory_candidates add constraint outside_period_proof_complete check(
 (last_public_at is null and outside_period_verified_at is null and outside_period_evidence_hash is null)
 or(last_public_at is not null and outside_period_verified_at is not null and outside_period_evidence_hash is not null and outside_period_evidence_hash ~ '^[a-f0-9]{64}$')
);
create or replace function public.record_clickdesk_outside_period_proofs(p_period text,p_rows jsonb,p_hash text)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>128 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid period proof';end if;
 update public.clickdesk_period_inventory_candidates c
 set last_public_at=x.last_public_at,outside_period_verified_at=now(),outside_period_evidence_hash=p_hash
 from jsonb_to_recordset(p_rows)x(ticket_id text,last_public_at timestamptz,source_version timestamptz),public.clickdesk_period_inventory r
 where c.period_key=p_period and r.period_key=c.period_key and c.ticket_id=x.ticket_id
 and isfinite(x.last_public_at) and isfinite(x.source_version)
 and c.source_updated_at<=x.source_version
 and (x.last_public_at at time zone 'America/Sao_Paulo')::date<r.start_date
 and exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=c.ticket_id and p.reason='final_author_ambiguous');
 get diagnostics affected=row_count;
 return affected;
end $$;
revoke all on function public.record_clickdesk_outside_period_proofs(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_clickdesk_outside_period_proofs(text,jsonb,text)to service_role;


create function public.finish_clickdesk_360_work(p_ticket text,p_lease uuid,p_analysis jsonb,p_model text,p_hash text,p_characters integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare w public.clickdesk_360_work_queue; l public.clickdesk_final_ticket_ledger;
begin
 select * into w from public.clickdesk_360_work_queue where ticket_id=p_ticket for update;
 if not found or w.status<>'processing' or w.lease_token is distinct from p_lease then return false; end if;
 select * into l from public.clickdesk_final_ticket_ledger where ticket_id=p_ticket;
 if not found or l.analyst_id<>w.analyst_id or l.satisfaction_label is distinct from w.satisfaction_label
 or l.occurred_date<>w.occurred_date or exists(select 1 from public.clickdesk_final_ticket_pending where ticket_id=p_ticket)
 or not exists(select 1 from public.chat_analysts where id=l.analyst_id and active) then
 update public.clickdesk_360_work_queue set status='failed',error_code='authorship_changed',lease_token=null,lease_until=null,updated_at=now() where ticket_id=p_ticket;
 return false; end if;
 if p_characters<1 or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_analysis)<>'object' then raise exception 'Invalid result'; end if;
 insert into public.clickdesk_qualitative_analyses(clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,transcript_hash,transcript_characters,created_by,validation_status,updated_at)
 values(p_ticket,l.analyst_id,l.occurred_date,l.area,l.satisfaction_label,p_analysis,p_model,p_hash,p_characters,null,'pending',now())
 on conflict(clickdesk_ticket_id) do update set
 analyst_id=excluded.analyst_id,occurred_date=excluded.occurred_date,area=excluded.area,satisfaction_label=excluded.satisfaction_label,
 analysis=excluded.analysis,model=excluded.model,transcript_hash=excluded.transcript_hash,transcript_characters=excluded.transcript_characters,updated_at=now(),
 validation_status=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id
 and clickdesk_qualitative_analyses.occurred_date=excluded.occurred_date
 and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validation_status else 'pending' end,
 validated_by=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validated_by else null end,
 validated_at=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validated_at else null end;
 update public.clickdesk_360_work_queue set status='done',completed_at=now(),error_code=null,lease_token=null,lease_until=null,updated_at=now() where ticket_id=p_ticket;
 return true;
end $$;
revoke all on function public.finish_clickdesk_360_work(text,uuid,jsonb,text,text,integer) from public,anon,authenticated;
grant execute on function public.finish_clickdesk_360_work(text,uuid,jsonb,text,text,integer) to service_role;

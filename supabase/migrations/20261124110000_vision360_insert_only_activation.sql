begin;
create or replace function public.finish_clickdesk_360_activation(
 p_ticket text,p_lease uuid,p_analysis jsonb,p_model text,p_hash text,p_characters integer,p_rating_hash text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare w public.clickdesk_360_work_queue; l public.clickdesk_final_ticket_ledger; n integer;
begin
 if p_ticket not in ('1098006','1082449') then return false;end if;
 if p_rating_hash is distinct from (case p_ticket
  when '1098006' then 'ab63b611c58d4af4065212da642afa2cf8d4b67e221c9fd04efdab81c022fea2'
  when '1082449' then '547c4124df4c459a2a72abf177a52dff499d823cb9ace71ea3a3b680220eeb35' end) then return false;end if;
 select * into w from public.clickdesk_360_work_queue where ticket_id=p_ticket for update;
 if not found or w.status<>'processing' or w.lease_token is distinct from p_lease
  or w.lease_until is null or w.lease_until<=clock_timestamp() then return false;end if;
 select * into l from public.clickdesk_final_ticket_ledger where ticket_id=p_ticket for share;
 if not found or l.analyst_id<>w.analyst_id or l.team_id<>w.team_id
  or l.satisfaction_label is distinct from w.satisfaction_label or l.occurred_date<>w.occurred_date
  or exists(select 1 from public.clickdesk_final_ticket_pending where ticket_id=p_ticket)
  or not exists(select 1 from public.chat_analysts where id=l.analyst_id and active)
  or not exists(select 1 from public.clickdesk_event_ratings r where r.ticket_id=p_ticket and r.source_hash=p_rating_hash and r.analyst_id=l.analyst_id)
 then return false;end if;
 if p_characters<40 or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_analysis)<>'object'
  or p_analysis->>'exclusion_eligible' is distinct from 'false'
  or p_analysis->>'_analysis_version' is distinct from '3' then raise exception 'Invalid activation result';end if;
 insert into public.clickdesk_qualitative_analyses(
  clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,
  transcript_hash,transcript_characters,created_by,validation_status,updated_at
 ) values(p_ticket,l.analyst_id,l.occurred_date,l.area,l.satisfaction_label,p_analysis,p_model,
  p_hash,p_characters,null,'pending',clock_timestamp())
 on conflict(clickdesk_ticket_id) do nothing;
 get diagnostics n=row_count;
 if n<>1 then
  update public.clickdesk_360_work_queue set status='failed',error_code='analysis_already_exists',
   lease_token=null,lease_until=null,updated_at=clock_timestamp() where ticket_id=p_ticket;
  return false;
 end if;
 update public.clickdesk_360_work_queue set status='done',completed_at=clock_timestamp(),error_code=null,
  lease_token=null,lease_until=null,updated_at=clock_timestamp() where ticket_id=p_ticket;
 return true;
end;
$$;
revoke all on function public.finish_clickdesk_360_activation(text,uuid,jsonb,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.finish_clickdesk_360_activation(text,uuid,jsonb,text,text,integer,text) to service_role;
commit;

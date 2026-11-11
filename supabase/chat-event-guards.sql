create function public.record_clickdesk_event_source_deletion(p_ticket text,p_lease uuid,p_deleted_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.clickdesk_event_capture_queue;
begin
 select * into q from public.clickdesk_event_capture_queue where ticket_id=p_ticket for update;
 if not found or q.lease_token is distinct from p_lease or p_deleted_at is null then return false; end if;
 insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
 values(p_ticket,'source_deleted','{}',jsonb_build_object('deleted_at',p_deleted_at,'evidence','GET /tickets?inbox=all&view=deleted'),md5(p_deleted_at::text)) on conflict do nothing;
 insert into public.clickdesk_event_ticket_history(ticket_id,source_version,events) values(p_ticket,q.source_version,'[]')
 on conflict do nothing;
 update public.clickdesk_event_capture_queue set status='complete',error_code='source_deleted',captured_at=now(),lease_until=null,lease_token=null where ticket_id=p_ticket;
 return true;
end $$;
revoke all on function public.record_clickdesk_event_source_deletion(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_clickdesk_event_source_deletion(text,uuid,timestamptz) to service_role;

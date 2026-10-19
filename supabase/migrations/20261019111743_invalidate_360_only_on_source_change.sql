
create function public.invalidate_clickdesk_360_on_source_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.analyst_id,new.team_id,new.occurred_date,new.last_public_message_id,new.last_public_at,new.satisfaction_label)
 is distinct from row(old.analyst_id,old.team_id,old.occurred_date,old.last_public_message_id,old.last_public_at,old.satisfaction_label) then
 update public.clickdesk_qualitative_analyses set
 analysis=jsonb_set(analysis,'{_analysis_version}','0'::jsonb,true),
 updated_at=now()
 where clickdesk_ticket_id=new.ticket_id and validation_status<>'rejected';
 if new.satisfaction_label in ('positive','negative') and exists(select 1 from public.chat_analysts where id=new.analyst_id and active) then
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 values(new.ticket_id,new.analyst_id,new.team_id,new.occurred_date,new.satisfaction_label)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,occurred_date=excluded.occurred_date,
 satisfaction_label=excluded.satisfaction_label,status='pending',attempts=0,error_code=null,lease_token=null,lease_until=null,next_attempt_at=now(),updated_at=now();
 end if;
 end if;
 return new;
end $$;
revoke all on function public.invalidate_clickdesk_360_on_source_change() from public,anon,authenticated;
create trigger clickdesk_360_source_changed after update on public.clickdesk_final_ticket_ledger
 for each row execute function public.invalidate_clickdesk_360_on_source_change();

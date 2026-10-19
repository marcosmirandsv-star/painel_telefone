create or replace function public.enqueue_clickdesk_360_on_ledger_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.occurred_date<date_trunc('month',now() at time zone 'America/Sao_Paulo')::date or new.occurred_date>(now() at time zone 'America/Sao_Paulo')::date then return new; end if;
 if new.satisfaction_label not in('positive','negative') or new.satisfaction_label is null or not exists(select 1 from public.chat_analysts where id=new.analyst_id and active) then return new; end if;
 if exists(select 1 from public.clickdesk_qualitative_analyses a where a.clickdesk_ticket_id=new.ticket_id and a.analyst_id=new.analyst_id and a.occurred_date=new.occurred_date and a.satisfaction_label=new.satisfaction_label and
 (a.validation_status='rejected' or case when a.analysis->>'_analysis_version' ~ '^[0-9]+$' then (a.analysis->>'_analysis_version')::numeric else 1 end>=2)) then return new; end if;
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 values(new.ticket_id,new.analyst_id,new.team_id,new.occurred_date,new.satisfaction_label)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,occurred_date=excluded.occurred_date,satisfaction_label=excluded.satisfaction_label,status='pending',attempts=0,error_code=null,lease_token=null,lease_until=null,next_attempt_at=now(),updated_at=now();
 return new;
end $$;
revoke all on function public.enqueue_clickdesk_360_on_ledger_insert() from public,anon,authenticated;


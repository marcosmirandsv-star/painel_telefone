
alter table public.clickdesk_360_worker_health add column cooldown_until timestamptz;
create or replace function public.claim_clickdesk_360_work(p_limit integer default 2)
returns setof public.clickdesk_360_work_queue language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('clickdesk_360_claim'));
 if exists(select 1 from public.clickdesk_360_worker_health where cooldown_until>now()) then return; end if;
 update public.clickdesk_360_work_queue set status=case when attempts<3 then 'pending' else 'failed' end,
 error_code='worker_lease_expired',lease_token=null,lease_until=null,updated_at=now()
 where status='processing' and lease_until<now();
 return query with picked as (
 select w.ticket_id from public.clickdesk_360_work_queue w
 where w.status='pending' and w.next_attempt_at<=now() and w.attempts<3
 and exists(select 1 from public.chat_analysts a where a.id=w.analyst_id and a.active)
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=w.ticket_id)
 order by w.attempts,w.occurred_date,w.satisfaction_label,w.ticket_id
 for update skip locked
 limit least(greatest(p_limit,1),greatest(0,2-(select count(*)::integer from public.clickdesk_360_work_queue where status='processing')))
 ) update public.clickdesk_360_work_queue w set status='processing',attempts=w.attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '150 seconds',updated_at=now()
 from picked p where w.ticket_id=p.ticket_id returning w.*;
end $$;

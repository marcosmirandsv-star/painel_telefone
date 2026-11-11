create or replace function public.publish_clickdesk_event_days(p_start date,p_end date)
returns boolean language plpgsql security definer set search_path='' as $$
declare h public.clickdesk_event_sync_health; snapshot_at timestamptz:=now();
begin
 select * into h from public.clickdesk_event_sync_health where singleton for update;
 if not found or not h.ratings_complete or h.ratings_start>p_start or h.ratings_end<p_end then return false; end if;
 if not exists(select 1 from public.clickdesk_period_inventory where period_key=to_char(p_start,'YYYY-MM') and status='complete' and cutoff_date>=p_end) then return false; end if;
 if exists(select 1 from public.clickdesk_period_inventory_candidates c left join public.clickdesk_event_capture_queue q using(ticket_id)
 where c.period_key=to_char(p_start,'YYYY-MM') and (q.ticket_id is null or q.status<>'complete' or q.source_version<c.source_updated_at)) then return false; end if;
 insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
 select 'day:'||p.occurred_date||':'||p.analyst_id,'closed_day_event_changed',
 jsonb_build_object('attendances',p.attendances),jsonb_build_object('attendances',x.n),md5(x.n::text)
 from public.clickdesk_event_published_daily p cross join lateral
 (select count(*) n from public.clickdesk_event_receipts r where r.analyst_id=p.analyst_id and r.occurred_date=p.occurred_date) x
 where p.occurred_date between p_start and p_end and p.occurred_date<(now() at time zone 'America/Sao_Paulo')::date
 and p.attendances<>x.n on conflict do nothing;
 with people as (
  select a.id,a.team_id from public.chat_analysts a join public.clickdesk_official_owner_registry r
  on r.source_owner_key=lower(regexp_replace(translate(trim(a.name),'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),'[^a-zA-Z0-9]+',' ','g'))
  where a.active and r.active and r.source_scope='suporte_erp_fiscal'
 ), days as(select d::date occurred_date from generate_series(p_start,p_end,'1 day') d), counts as (
  select d.occurred_date,p.id analyst_id,p.team_id,
  (select count(*) from public.clickdesk_event_receipts x where x.analyst_id=p.id and x.occurred_date=d.occurred_date)::integer attendances,
  (select count(*) from public.clickdesk_event_ratings x where x.analyst_id=p.id and x.occurred_date=d.occurred_date and x.sentiment='positive')::integer positive_reviews,
  (select count(*) from public.clickdesk_event_ratings x where x.analyst_id=p.id and x.occurred_date=d.occurred_date and x.sentiment='negative')::integer negative_reviews,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and n.status='verified' and n.exclusion_eligible)::integer excluded_neutrals,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and x.original_label='Neutro' and n.status='verified' and n.cause in ('human','mixed'))::integer neutral_human,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and x.original_label='Neutro' and n.status='verified' and n.cause in ('system','other_external'))::integer neutral_external,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.status<>'verified')::integer neutral_pending
  from days d cross join people p
 ) insert into public.clickdesk_event_published_daily select *,snapshot_at from counts
 on conflict(occurred_date,analyst_id) do update set
 attendances=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.attendances else clickdesk_event_published_daily.attendances end,
 positive_reviews=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.positive_reviews else clickdesk_event_published_daily.positive_reviews end,
 negative_reviews=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.negative_reviews else clickdesk_event_published_daily.negative_reviews end,
 excluded_neutrals=excluded.excluded_neutrals,neutral_human=excluded.neutral_human,neutral_external=excluded.neutral_external,neutral_pending=excluded.neutral_pending,captured_at=excluded.captured_at
 where not exists(select 1 from public.integration_closures c where c.channel='chat'
 and c.month=to_char(excluded.occurred_date,'YYYY-MM') and (c.team='all' or c.team=excluded.team_id::text));
 update public.clickdesk_event_sync_health set finished_at=snapshot_at,status='ready',error_code=null where singleton;
 return true;
end $$;
revoke all on function public.publish_clickdesk_event_days(date,date) from public,anon,authenticated;
grant execute on function public.publish_clickdesk_event_days(date,date) to service_role;

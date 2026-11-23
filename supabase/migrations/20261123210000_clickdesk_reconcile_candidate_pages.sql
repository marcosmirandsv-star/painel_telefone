-- Release candidate only. No source rows, reviews, ratings or confirmed ownership are changed.
-- Apply before publishing the route. SECURITY INVOKER; service_role is the sole API caller.
begin;
create or replace function public.clickdesk_reconcile_candidates(p_period text default null)
returns table(ticket_id text, source_updated_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with inventory as (
    select i.ticket_id,i.source_updated_at
    from public.clickdesk_period_inventory_candidates i
    where p_period is null or i.period_key=p_period
  ), sources as (
    select a.clickdesk_ticket_id::text as ticket_id,a.updated_at as source_updated_at
    from public.clickdesk_chat_attendances a
    where p_period is null or exists(select 1 from inventory i where i.ticket_id=a.clickdesk_ticket_id::text)
    union all
    select v.ticket_id::text,v.verified_at
    from public.clickdesk_chat_verified_contributions v
    where p_period is null or exists(select 1 from inventory i where i.ticket_id=v.ticket_id::text)
    union all
    select q.ticket_id::text,q.source_updated_at
    from public.clickdesk_chat_capture_queue q
    where p_period is null or exists(select 1 from inventory i where i.ticket_id=q.ticket_id::text)
    union all
    select i.ticket_id,i.source_updated_at from inventory i
  )
  select btrim(s.ticket_id) collate "C",max(s.source_updated_at)
  from sources s where nullif(btrim(s.ticket_id),'') is not null
  group by btrim(s.ticket_id) collate "C"
$$;

create or replace function public.clickdesk_reconcile_candidate_page(
  p_cursor text default '',p_limit integer default 6,p_period text default null
) returns table(ticket_id text,version text)
language plpgsql stable security invoker set search_path = '' set statement_timeout='5s' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>12 or p_cursor is null or length(p_cursor)>80
    or (p_period is not null and p_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') then
    raise exception 'Invalid reconcile page parameters' using errcode='22023';
  end if;
  if p_period is not null then
    -- Scope membership comes only from this period's inventory. The other sources
    -- can enrich source version but cannot introduce an out-of-period candidate.
    return query
      with selected as materialized (
        select i.ticket_id,i.source_updated_at
        from public.clickdesk_period_inventory_candidates i
        where i.period_key=p_period and i.ticket_id collate "C">p_cursor collate "C"
        order by i.ticket_id collate "C" limit p_limit+1
      )
      select i.ticket_id,coalesce(to_char(v.latest at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'')
      from selected i
      cross join lateral (
        select max(s.source_updated_at) latest from (
          select i.source_updated_at
          union all select a.updated_at from public.clickdesk_chat_attendances a where a.clickdesk_ticket_id::text=i.ticket_id
          union all select c.verified_at from public.clickdesk_chat_verified_contributions c where c.ticket_id::text=i.ticket_id
          union all select q.source_updated_at from public.clickdesk_chat_capture_queue q where q.ticket_id::text=i.ticket_id
        ) s
      ) v order by i.ticket_id collate "C";
  else
    return query
      select c.ticket_id,coalesce(to_char(c.source_updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'')
      from public.clickdesk_reconcile_candidates(null) c
      where c.ticket_id collate "C">p_cursor collate "C"
      order by c.ticket_id collate "C" limit p_limit+1;
  end if;
end
$$;

create or replace function public.clickdesk_reconcile_candidate_coverage(p_period text default null)
returns table(candidate_count bigint,confirmed_count bigint,pending_count bigint)
language sql stable security invoker set search_path = '' set statement_timeout='5s' as $$
  select count(*),
    count(*) filter(where p.ticket_id is null and l.ticket_id is not null
      and (c.source_updated_at is null or l.verified_at>=c.source_updated_at)),
    count(*) filter(where p.ticket_id is not null)
  from public.clickdesk_reconcile_candidates(p_period) c
  left join public.clickdesk_final_ticket_ledger l on l.ticket_id=c.ticket_id
  left join public.clickdesk_final_ticket_pending p on p.ticket_id=c.ticket_id
$$;
revoke all on function public.clickdesk_reconcile_candidates(text) from public,anon,authenticated;
revoke all on function public.clickdesk_reconcile_candidate_page(text,integer,text) from public,anon,authenticated;
revoke all on function public.clickdesk_reconcile_candidate_coverage(text) from public,anon,authenticated;
grant execute on function public.clickdesk_reconcile_candidates(text) to service_role;
grant execute on function public.clickdesk_reconcile_candidate_page(text,integer,text) to service_role;
grant execute on function public.clickdesk_reconcile_candidate_coverage(text) to service_role;
commit;

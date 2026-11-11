-- Homologação only. Event time, immutable receipts and auditable neutral adjustments.
begin;
create table if not exists public.clickdesk_event_capture_queue (
 ticket_id text primary key, source_version timestamptz not null,
 status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
 attempts integer not null default 0, lease_until timestamptz, lease_token uuid,
 next_attempt_at timestamptz not null default now(), error_code text, captured_at timestamptz
);
create table if not exists public.clickdesk_event_ticket_history (
 ticket_id text primary key, source_version timestamptz not null, events jsonb not null,
 captured_at timestamptz not null default now(), check(jsonb_typeof(events)='array')
);
create table if not exists public.clickdesk_event_receipts (
 ticket_id text not null, analyst_id uuid not null references public.chat_analysts(id),
 team_id uuid not null references public.chat_teams(id),event_id text not null,
 received_at timestamptz not null, occurred_date date not null, department text not null,
 recorded_at timestamptz not null default now(), primary key(ticket_id,analyst_id),
 check(occurred_date=(received_at at time zone 'America/Sao_Paulo')::date)
);
create index if not exists clickdesk_event_receipts_date on public.clickdesk_event_receipts(occurred_date,analyst_id);
create table if not exists public.clickdesk_event_ratings (
 ticket_id text primary key, ticket_number text, analyst_id uuid not null references public.chat_analysts(id),
 team_id uuid not null references public.chat_teams(id), rated_at timestamptz not null,
 occurred_date date not null, sentiment text not null check(sentiment in ('positive','negative')),
 original_label text not null, source_hash text not null, captured_at timestamptz not null default now(),
 check(occurred_date=(rated_at at time zone 'America/Sao_Paulo')::date)
);
create table if not exists public.clickdesk_neutral_reviews (
 ticket_id text primary key references public.clickdesk_event_ratings(ticket_id), analyst_id uuid not null references public.chat_analysts(id),
 cause text not null default 'inconclusive' check(cause in ('human','system','other_external','mixed','inconclusive')),
 status text not null default 'pending' check(status in ('pending','processing','verified','needs_review','technical_failure')),
 attempts integer not null default 0, source_hash text not null, transcript_hash text,
 analysis jsonb, exclusion_eligible boolean not null default false,
 lease_until timestamptz,lease_token uuid,next_attempt_at timestamptz not null default now(),
 error_code text, model text, reviewed_at timestamptz,
 check(not exclusion_eligible or (status='verified' and cause in ('system','other_external') and transcript_hash is not null))
);
create table if not exists public.clickdesk_event_corrections (
 id bigint generated always as identity primary key,ticket_id text not null,
 kind text not null, previous jsonb not null, proposed jsonb not null,
 source_hash text not null, detected_at timestamptz not null default now(),
 unique(ticket_id,kind,source_hash)
);
create table if not exists public.clickdesk_event_sync_health (
 singleton boolean primary key default true check(singleton), started_at timestamptz,
 finished_at timestamptz,status text not null default 'pending',error_code text,
 ratings_start date,ratings_end date,ratings_complete boolean not null default false
);
create table if not exists public.clickdesk_event_published_daily (
 occurred_date date not null,analyst_id uuid not null references public.chat_analysts(id),team_id uuid not null,
 attendances integer not null,positive_reviews integer not null,negative_reviews integer not null,
 excluded_neutrals integer not null default 0,neutral_human integer not null default 0,
 neutral_external integer not null default 0,neutral_pending integer not null default 0,
 captured_at timestamptz not null,primary key(occurred_date,analyst_id)
);
alter table public.clickdesk_event_capture_queue enable row level security;
alter table public.clickdesk_event_ticket_history enable row level security;
alter table public.clickdesk_event_receipts enable row level security;
alter table public.clickdesk_event_ratings enable row level security;
alter table public.clickdesk_neutral_reviews enable row level security;
alter table public.clickdesk_event_corrections enable row level security;
alter table public.clickdesk_event_sync_health enable row level security;
alter table public.clickdesk_event_published_daily enable row level security;
revoke all on public.clickdesk_event_capture_queue,public.clickdesk_event_ticket_history,public.clickdesk_event_receipts,public.clickdesk_event_ratings,public.clickdesk_neutral_reviews,public.clickdesk_event_corrections,public.clickdesk_event_sync_health from public,anon,authenticated;
grant all on public.clickdesk_event_capture_queue,public.clickdesk_event_ticket_history,public.clickdesk_event_receipts,public.clickdesk_event_ratings,public.clickdesk_neutral_reviews,public.clickdesk_event_corrections,public.clickdesk_event_sync_health to service_role;
grant usage,select on sequence public.clickdesk_event_corrections_id_seq to service_role;
grant select on public.clickdesk_event_receipts,public.clickdesk_event_ratings,public.clickdesk_neutral_reviews to authenticated;
revoke all on public.clickdesk_event_published_daily from public,anon,authenticated;
grant all on public.clickdesk_event_published_daily to service_role;
grant select on public.clickdesk_event_published_daily to authenticated;
create policy published_scope on public.clickdesk_event_published_daily for select to authenticated using((select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id()));
create policy receipt_scope on public.clickdesk_event_receipts for select to authenticated using((select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id()));
create policy rating_scope on public.clickdesk_event_ratings for select to authenticated using((select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id()));
create policy neutral_scope on public.clickdesk_neutral_reviews for select to authenticated using((select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id()));

create or replace function public.claim_clickdesk_event_capture(p_period text,p_limit integer default 64)
returns setof public.clickdesk_event_capture_queue language plpgsql security definer set search_path='' as $$
begin
 insert into public.clickdesk_event_capture_queue(ticket_id,source_version)
 select ticket_id,source_updated_at from public.clickdesk_period_inventory_candidates where period_key=p_period
 on conflict(ticket_id) do update set source_version=excluded.source_version,
 status=case when excluded.source_version>clickdesk_event_capture_queue.source_version then 'pending' else clickdesk_event_capture_queue.status end,
 attempts=case when excluded.source_version>clickdesk_event_capture_queue.source_version then 0 else clickdesk_event_capture_queue.attempts end,
 next_attempt_at=case when excluded.source_version>clickdesk_event_capture_queue.source_version then now() else clickdesk_event_capture_queue.next_attempt_at end;
 return query with chosen as (select q.ticket_id from public.clickdesk_event_capture_queue q
 where ((q.status in ('pending','failed') and q.next_attempt_at<=now()) or (q.status='processing' and q.lease_until<now()))
 order by q.source_version desc,q.ticket_id limit least(greatest(p_limit,1),128) for update skip locked)
 update public.clickdesk_event_capture_queue q set status='processing',attempts=q.attempts+1,
 lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid() from chosen c where q.ticket_id=c.ticket_id returning q.*;
end $$;
revoke all on function public.claim_clickdesk_event_capture(text,integer) from public,anon,authenticated;
grant execute on function public.claim_clickdesk_event_capture(text,integer) to service_role;

create or replace function public.finish_clickdesk_event_capture(p_ticket text,p_lease uuid,p_events jsonb,p_receipts jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.clickdesk_event_capture_queue; r record; old_row public.clickdesk_event_receipts;
begin
 select * into q from public.clickdesk_event_capture_queue where ticket_id=p_ticket for update;
 if not found or q.lease_token is distinct from p_lease or q.status<>'processing' then return false; end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_typeof(p_receipts)<>'array' then raise exception 'Invalid event payload'; end if;
 for r in select * from jsonb_to_recordset(p_receipts) as x(ticket_id text,event_id text,analyst_id uuid,team_id uuid,received_at timestamptz,occurred_date date,department text) loop
  if r.ticket_id<>p_ticket or not exists(select 1 from jsonb_array_elements(p_events) e where e->>'id'=r.event_id) then raise exception 'Unproven receipt'; end if;
  select * into old_row from public.clickdesk_event_receipts where ticket_id=p_ticket and analyst_id=r.analyst_id;
  if found and (old_row.received_at is distinct from r.received_at or old_row.event_id is distinct from r.event_id) then
   insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
   values(p_ticket,'receipt_event_changed',to_jsonb(old_row),to_jsonb(r),md5(to_jsonb(r)::text)) on conflict do nothing;
  else
   insert into public.clickdesk_event_receipts(ticket_id,analyst_id,team_id,event_id,received_at,occurred_date,department)
   values(p_ticket,r.analyst_id,r.team_id,r.event_id,r.received_at,r.occurred_date,r.department) on conflict do nothing;
  end if;
 end loop;
 insert into public.clickdesk_event_ticket_history(ticket_id,source_version,events) values(p_ticket,q.source_version,p_events)
 on conflict(ticket_id) do update set source_version=excluded.source_version,events=excluded.events,captured_at=now();
 update public.clickdesk_event_capture_queue set status='complete',captured_at=now(),lease_token=null,lease_until=null,error_code=null where ticket_id=p_ticket;
 return true;
end $$;
revoke all on function public.finish_clickdesk_event_capture(text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_clickdesk_event_capture(text,uuid,jsonb,jsonb) to service_role;

create or replace function public.get_scoped_clickdesk_event_status(p_start date,p_end date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer; done integer; h public.clickdesk_event_sync_health; inventory_ready boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and lower(p.role::text) in ('master','coordenadora','coordinator','analista','analyst')) then raise exception 'Unauthorized'; end if;
 select count(*),count(*) filter(where q.status='complete' and q.source_version>=c.source_updated_at) into n,done
 from public.clickdesk_period_inventory_candidates c left join public.clickdesk_event_capture_queue q using(ticket_id)
 where c.period_key=to_char(p_start,'YYYY-MM');
 select status='complete' and cutoff_date>=p_end into inventory_ready from public.clickdesk_period_inventory where period_key=to_char(p_start,'YYYY-MM');
 select * into h from public.clickdesk_event_sync_health where singleton;
 return jsonb_build_object('complete',coalesce(inventory_ready,false) and n>0 and done=n and h.ratings_complete and h.ratings_start<=p_start and h.ratings_end>=p_end,
 'captured_at',h.finished_at,'status',coalesce(h.status,'pending'),
 'pending',case when public.is_management_user() then n-done else null end);
end $$;
revoke all on function public.get_scoped_clickdesk_event_status(date,date) from public,anon;
grant execute on function public.get_scoped_clickdesk_event_status(date,date) to authenticated;

create or replace function public.save_clickdesk_event_rating(p_row jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.clickdesk_event_ratings; old_row public.clickdesk_event_ratings;
begin
 r:=jsonb_populate_record(null::public.clickdesk_event_ratings,p_row);
 select * into old_row from public.clickdesk_event_ratings where ticket_id=r.ticket_id for update;
 if found and old_row.source_hash<>r.source_hash and old_row.occurred_date<(now() at time zone 'America/Sao_Paulo')::date then
  insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash) values(r.ticket_id,'closed_rating_changed',to_jsonb(old_row),p_row,r.source_hash) on conflict do nothing;
  return;
 end if;
 insert into public.clickdesk_event_ratings(ticket_id,ticket_number,analyst_id,team_id,rated_at,occurred_date,sentiment,original_label,source_hash)
 values(r.ticket_id,r.ticket_number,r.analyst_id,r.team_id,r.rated_at,r.occurred_date,r.sentiment,r.original_label,r.source_hash)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,rated_at=excluded.rated_at,occurred_date=excluded.occurred_date,
 sentiment=excluded.sentiment,original_label=excluded.original_label,source_hash=excluded.source_hash,captured_at=now();
 if lower(r.original_label)='neutro' and r.sentiment='negative' then
  insert into public.clickdesk_neutral_reviews(ticket_id,analyst_id,source_hash) values(r.ticket_id,r.analyst_id,r.source_hash)
  on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,source_hash=excluded.source_hash,
  status=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then 'pending' else clickdesk_neutral_reviews.status end,
  exclusion_eligible=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then false else clickdesk_neutral_reviews.exclusion_eligible end,
  attempts=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then 0 else clickdesk_neutral_reviews.attempts end;
 end if;
end $$;
revoke all on function public.save_clickdesk_event_rating(jsonb) from public,anon,authenticated;
grant execute on function public.save_clickdesk_event_rating(jsonb) to service_role;

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
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.status='verified' and n.cause in ('human','mixed'))::integer neutral_human,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.status='verified' and n.cause in ('system','other_external'))::integer neutral_external,
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
commit;

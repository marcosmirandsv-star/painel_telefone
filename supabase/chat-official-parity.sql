create table public.clickdesk_official_period_votes (
 period_start date not null,period_end date not null,ticket_id text not null,
 analyst_id uuid not null references public.chat_analysts(id),source_owner_key text not null,
 ticket_number text not null,team_id uuid not null references public.chat_teams(id),rated_at timestamptz not null,occurred_date date not null,
 sentiment text not null check(sentiment in ('positive','negative')),original_label text not null,source_hash text not null,
 primary key(period_start,period_end,ticket_id),check(period_start<=period_end)
);
alter table public.clickdesk_official_period_votes enable row level security;
grant select on public.clickdesk_official_period_votes to authenticated;
grant all on public.clickdesk_official_period_votes to service_role;
create policy official_votes_scope on public.clickdesk_official_period_votes for select to authenticated using((select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id()));
create table public.clickdesk_official_capture_audit (
 id bigint generated always as identity primary key,period_start date not null,period_end date not null,captured_at timestamptz not null default now(),metrics jsonb not null,votes jsonb not null default '[]'::jsonb
);
alter table public.clickdesk_official_capture_audit enable row level security;
grant all on public.clickdesk_official_capture_audit to service_role;
grant usage,select on sequence public.clickdesk_official_capture_audit_id_seq to service_role;
create table public.clickdesk_official_period_requests (
 period_start date not null,period_end date not null,requested_at timestamptz not null default now(),requested_by uuid,primary key(period_start,period_end)
);
alter table public.clickdesk_official_period_requests enable row level security;
grant all on public.clickdesk_official_period_requests to service_role;
create or replace function public.publish_clickdesk_official_capture(p_rows jsonb,p_votes jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare first_row jsonb; v jsonb; a record; source jsonb; hash text; start_day date;end_day date;
begin
 if jsonb_array_length(p_rows)=0 then raise exception 'empty_capture';end if;
 first_row:=p_rows->0;start_day:=(first_row->>'period_start')::date;end_day:=(first_row->>'period_end')::date;
 if start_day>end_day or end_day>(now() at time zone 'America/Sao_Paulo')::date or end_day-start_day>31 then raise exception 'invalid_period';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'period_start')::date<>start_day or (x->>'period_end')::date<>end_day) then raise exception 'mixed_periods';end if;
 for v in select value from jsonb_array_elements(p_rows) loop
  if (v->>'positive_reviews')::integer<>(select count(*) from jsonb_array_elements(p_votes) x where x->>'source_owner_key'=v->>'source_owner_key' and x->>'sentiment'='positive') or
  (v->>'negative_reviews')::integer<>(select count(*) from jsonb_array_elements(p_votes) x where x->>'source_owner_key'=v->>'source_owner_key' and x->>'sentiment'='negative') then raise exception 'vote_counts_do_not_reconcile';end if;
 end loop;
 insert into public.clickdesk_official_capture_audit(period_start,period_end,metrics,votes)
 select start_day,end_day,coalesce((select jsonb_agg(to_jsonb(m)) from public.clickdesk_official_period_metrics m where m.period_start=start_day and m.period_end=end_day),'[]'::jsonb),coalesce((select jsonb_agg(to_jsonb(pv)) from public.clickdesk_official_period_votes pv where pv.period_start=start_day and pv.period_end=end_day),'[]'::jsonb);
 delete from public.clickdesk_official_period_votes where period_start=start_day and period_end=end_day;
 for v in select value from jsonb_array_elements(p_votes) loop
  select ca.id,ca.team_id into a from public.chat_analysts ca join public.clickdesk_official_owner_registry r on r.active and r.source_owner_key=v->>'source_owner_key'
  where ca.active and lower(regexp_replace(translate(trim(ca.name),'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),'[^a-zA-Z0-9]+',' ','g'))=r.source_owner_key;
  if a.id is null then raise exception 'vote_owner_not_registered';end if;
  source:=jsonb_build_object('ticket_id',v->>'ticket_id','ticket_number',v->>'ticket_number','analyst_id',a.id,'team_id',a.team_id,
   'rated_at',v->>'rated_at','occurred_date',((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date,'sentiment',v->>'sentiment','original_label',v->>'original_label');
  hash:=encode(extensions.digest(convert_to(source::text,'UTF8'),'sha256'),'hex');
  -- Reuse an existing evidence hash only when every original rating field is identical.
  select coalesce((select e.source_hash from public.clickdesk_event_ratings e where e.ticket_id=v->>'ticket_id' and e.ticket_number=v->>'ticket_number'
   and e.analyst_id=a.id and e.team_id=a.team_id and e.rated_at=(v->>'rated_at')::timestamptz and e.sentiment=v->>'sentiment' and e.original_label=v->>'original_label'),hash) into hash;
  -- Append missing evidence only. Existing ratings and reviews are never updated.
  insert into public.clickdesk_event_ratings(ticket_id,ticket_number,analyst_id,team_id,rated_at,occurred_date,sentiment,original_label,source_hash)
  values(v->>'ticket_id',v->>'ticket_number',a.id,a.team_id,(v->>'rated_at')::timestamptz,((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date,v->>'sentiment',v->>'original_label',hash) on conflict(ticket_id) do nothing;
  if v->>'original_label'='Neutro' and v->>'sentiment'='negative' and exists(select 1 from public.clickdesk_event_ratings e where e.ticket_id=v->>'ticket_id' and e.source_hash=hash) then
   insert into public.clickdesk_neutral_reviews(ticket_id,analyst_id,source_hash) values(v->>'ticket_id',a.id,hash) on conflict(ticket_id) do nothing;
  end if;
  insert into public.clickdesk_official_period_votes(period_start,period_end,ticket_id,analyst_id,source_owner_key,sentiment,original_label,source_hash,ticket_number,team_id,rated_at,occurred_date) values(start_day,end_day,v->>'ticket_id',a.id,v->>'source_owner_key',v->>'sentiment',v->>'original_label',hash,v->>'ticket_number',a.team_id,(v->>'rated_at')::timestamptz,((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date);
 end loop;
 insert into public.clickdesk_official_period_metrics select * from jsonb_populate_recordset(null::public.clickdesk_official_period_metrics,p_rows)
 on conflict(period_start,period_end,source_owner_key,source_scope) do update set attendances=excluded.attendances,replies=excluded.replies,resolved=excluded.resolved,
 positive_reviews=excluded.positive_reviews,negative_reviews=excluded.negative_reviews,captured_at=excluded.captured_at,source_note=excluded.source_note,attendance_basis=excluded.attendance_basis;
 insert into public.clickdesk_official_capture_audit(period_start,period_end,metrics,votes) select start_day,end_day,p_rows,coalesce(jsonb_agg(to_jsonb(pv)),'[]'::jsonb) from public.clickdesk_official_period_votes pv where pv.period_start=start_day and pv.period_end=end_day;
 return true;
end $$;
revoke all on function public.publish_clickdesk_official_capture(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.publish_clickdesk_official_capture(jsonb,jsonb) to service_role;
create or replace function public.get_scoped_clickdesk_official_neutral_counts(p_start date,p_end date)
returns table(period_start date,period_end date,source_owner_key text,excluded_neutrals bigint,neutral_human bigint,neutral_external bigint,neutral_pending bigint)
language sql stable set search_path='' as $$
 select v.period_start,v.period_end,v.source_owner_key,
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.exclusion_eligible),
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.cause in ('human','mixed')),
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.cause in ('system','other_external')),
 count(*) filter(where n.ticket_id is null or n.source_hash<>v.source_hash or n.status<>'verified')
 from public.clickdesk_official_period_votes v left join public.clickdesk_neutral_reviews n using(ticket_id)
 where v.original_label='Neutro' and v.sentiment='negative' and ((v.period_start=p_start and v.period_end=p_end) or (v.period_start=v.period_end and v.period_start between p_start and p_end))
 group by v.period_start,v.period_end,v.source_owner_key;
$$;
revoke all on function public.get_scoped_clickdesk_official_neutral_counts(date,date) from public,anon;
grant execute on function public.get_scoped_clickdesk_official_neutral_counts(date,date) to authenticated,service_role;
create or replace function public.request_clickdesk_official_period(p_start date,p_end date)
returns boolean language plpgsql security definer set search_path='' as $$
declare last_request timestamptz;
begin
 if auth.uid() is null or not(public.is_management_user() or public.current_user_chat_analyst_id() is not null) then raise exception 'unauthorized' using errcode='42501';end if;
 if p_start is null or p_end is null or p_start<date '2026-11-01' or p_start>p_end or p_end>(now() at time zone 'America/Sao_Paulo')::date or date_trunc('month',p_start)<>date_trunc('month',p_end) then raise exception 'invalid_period';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.clickdesk_official_period_requests where requested_by=auth.uid() and requested_at>now()-interval '1 minute')>=3 then return false;end if;
 insert into public.clickdesk_official_period_requests(period_start,period_end,requested_at) values(p_start,p_end,now()-interval '1 hour') on conflict do nothing;
 select requested_at into last_request from public.clickdesk_official_period_requests where period_start=p_start and period_end=p_end for update;
 if last_request>now()-interval '90 seconds' then return false;end if;
 update public.clickdesk_official_period_requests set requested_at=now(),requested_by=auth.uid() where period_start=p_start and period_end=p_end;
 perform net.http_post(url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-official-metrics-sync',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),body:=jsonb_build_object('start',p_start,'end',p_end),timeout_milliseconds:=120000);
 return true;
end $$;
revoke all on function public.request_clickdesk_official_period(date,date) from public,anon;
grant execute on function public.request_clickdesk_official_period(date,date) to authenticated;

begin;
create table public.cx360_sources (
  team_id uuid primary key references public.chat_teams(id), source_name text not null unique, display_name text not null
);
insert into public.cx360_sources(team_id,source_name,display_name)
select id,'Suporte - Fiscal','Especializado / Suporte Fiscal' from public.chat_teams where name='Marcos Miranda - Chat Notas';
insert into public.cx360_sources(team_id,source_name,display_name)
select id,'Suporte - ERP','Suporte ERP' from public.chat_teams where name='Polyana Ventura - Chat Outros';
do $$ begin if (select count(*) from public.cx360_sources)<>2 then raise exception 'Confirmar correspondência das equipes antes de publicar'; end if; end $$;
create table public.cx360_ratings (
  id text primary key, ticket_id text not null check(ticket_id ~ '^\d+$'), number text not null,
  team_id uuid not null references public.cx360_sources(team_id), source_team text not null,
  subject text not null, rated_at timestamptz not null, rated_day date not null, label text not null,
  owner_name text not null, eligible boolean not null, excluded_reason text, comment text not null default '',
  source_hash text not null, active boolean not null default true,
  status text not null default 'pending' check(status in ('pending','processing','analyzed','inconclusive','failed')),
  analysis jsonb, evidence jsonb not null default '[]', analysis_hash text, model text, analysis_version text,
  attempts integer not null default 0, error_code text, next_attempt_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
  updated_at timestamptz not null default now(), unique(ticket_id,rated_at)
);
create index cx360_ratings_scope on public.cx360_ratings(rated_day,team_id,active);
create index cx360_ratings_work on public.cx360_ratings(status,next_attempt_at) where eligible and active;
create table public.cx360_sync_runs (
 id uuid primary key default gen_random_uuid(), start_date date not null,end_date date not null,
 status text not null check(status in ('complete','failed')), source_total integer not null default 0, imported integer not null default 0,
 error_code text,requested_by uuid references public.profiles(id),created_at timestamptz not null default now()
);
create index cx360_sync_scope on public.cx360_sync_runs(start_date,end_date,created_at desc);
create table public.cx360_reviews (
 id uuid primary key default gen_random_uuid(),rating_id text not null references public.cx360_ratings(id),analysis_hash text not null,
 decision text not null check(decision in ('confirmed','rejected')),notes text not null check(length(btrim(notes)) between 10 and 3000),
 reviewed_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index cx360_review_rating on public.cx360_reviews(rating_id,created_at desc);
create index cx360_review_author on public.cx360_reviews(reviewed_by);
alter table public.cx360_cases add column diagnostic_id text references public.cx360_ratings(id);
alter table public.cx360_cases add column diagnostic_hash text;
create index cx360_case_diagnostic on public.cx360_cases(diagnostic_id);
create function cx360_private.protect_diagnostic_reference() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.diagnostic_id,new.diagnostic_hash) is distinct from (old.diagnostic_id,old.diagnostic_hash) then raise exception 'Diagnostic reference is immutable';end if;
 if tg_op='INSERT' and new.diagnostic_id is not null and not exists(select 1 from public.cx360_ratings r where r.id=new.diagnostic_id and r.analysis_hash=new.diagnostic_hash and r.ticket_id=new.ticket_id and r.team_id=new.team_id and r.active and r.eligible) then raise exception 'Diagnostic changed; review the current evidence';end if;
 return new;
end $$;
revoke all on function cx360_private.protect_diagnostic_reference() from public,anon,authenticated;
create trigger cx360_protect_reference before insert or update on public.cx360_cases for each row execute function cx360_private.protect_diagnostic_reference();
alter table public.cx360_sources enable row level security;
alter table public.cx360_ratings enable row level security;
alter table public.cx360_sync_runs enable row level security;
alter table public.cx360_reviews enable row level security;
revoke all on public.cx360_sources,public.cx360_ratings,public.cx360_sync_runs,public.cx360_reviews from public,anon,authenticated;
grant select on public.cx360_sources,public.cx360_ratings,public.cx360_sync_runs,public.cx360_reviews to authenticated;
grant all on public.cx360_sources,public.cx360_ratings,public.cx360_sync_runs,public.cx360_reviews to service_role;
create policy cx360_sources_read on public.cx360_sources for select to authenticated using ((select public.is_management_user()));
create policy cx360_ratings_read on public.cx360_ratings for select to authenticated using ((select public.is_management_user()));
create policy cx360_sync_read on public.cx360_sync_runs for select to authenticated using ((select public.is_management_user()));
create policy cx360_reviews_read on public.cx360_reviews for select to authenticated using ((select public.is_management_user()));
create or replace function cx360_private.rating_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.source_hash is distinct from old.source_hash then
   new.status:='pending';new.analysis:=null;new.evidence:='[]';new.analysis_hash:=null;new.attempts:=0;new.next_attempt_at:=now();new.lease_token:=null;new.lease_until:=null;new.error_code:=null;
 end if;return new;
end $$;
revoke all on function cx360_private.rating_changed() from public,anon,authenticated;
create trigger cx360_rating_source_change before update on public.cx360_ratings for each row execute function cx360_private.rating_changed();
create function public.cx360_ingest(p_start date,p_end date,p_rows jsonb,p_total integer,p_user uuid default null) returns integer language plpgsql security invoker set search_path='' as $$
declare r jsonb;n integer:=0;
begin
 if p_start is null or p_end is null or p_start>p_end or p_end> ((now() at time zone 'America/Sao_Paulo')::date-1) or p_end-p_start>31 then raise exception 'Invalid D-1 scope';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>10000 then raise exception 'Invalid payload';end if;
 perform pg_advisory_xact_lock(hashtext('cx360_ingest'));
 for r in select value from jsonb_array_elements(p_rows) loop
   if (r->>'rated_day')::date not between p_start and p_end then raise exception 'Rating outside scope';end if;
   insert into public.cx360_ratings(id,ticket_id,number,team_id,source_team,subject,rated_at,rated_day,label,owner_name,eligible,excluded_reason,comment,source_hash,active)
   values(r->>'id',r->>'ticket_id',r->>'number',(r->>'team_id')::uuid,r->>'source_team',r->>'subject',(r->>'rated_at')::timestamptz,(r->>'rated_day')::date,r->>'label',r->>'owner_name',(r->>'eligible')::boolean,r->>'excluded_reason',r->>'comment',r->>'source_hash',true)
   on conflict(id) do update set team_id=excluded.team_id,source_team=excluded.source_team,subject=excluded.subject,label=excluded.label,owner_name=excluded.owner_name,eligible=excluded.eligible,excluded_reason=excluded.excluded_reason,comment=excluded.comment,source_hash=excluded.source_hash,active=true,updated_at=now();
   n:=n+1;
 end loop;
 update public.cx360_ratings set active=false,updated_at=now() where rated_day between p_start and p_end and not exists(select 1 from jsonb_array_elements(p_rows) j where j->>'id'=public.cx360_ratings.id);
 insert into public.cx360_sync_runs(start_date,end_date,status,source_total,imported,requested_by) values(p_start,p_end,'complete',p_total,n,p_user);
 return n;
end $$;
revoke all on function public.cx360_ingest(date,date,jsonb,integer,uuid) from public,anon,authenticated;
grant execute on function public.cx360_ingest(date,date,jsonb,integer,uuid) to service_role;
create function public.cx360_claim(p_start date,p_end date,p_team uuid default null,p_limit integer default 3) returns setof public.cx360_ratings language sql security invoker set search_path='' as $$
 with picked as (
  select id from public.cx360_ratings where active and eligible and rated_day between p_start and least(p_end,((now() at time zone 'America/Sao_Paulo')::date-1))
   and (p_team is null or team_id=p_team) and attempts<3 and next_attempt_at<=now()
   and (status='pending' or (status='processing' and lease_until<now())) order by rated_at,id for update skip locked limit least(greatest(p_limit,1),5)
 ) update public.cx360_ratings r set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() from picked where r.id=picked.id returning r.*;
$$;
revoke all on function public.cx360_claim(date,date,uuid,integer) from public,anon,authenticated;
grant execute on function public.cx360_claim(date,date,uuid,integer) to service_role;
commit;

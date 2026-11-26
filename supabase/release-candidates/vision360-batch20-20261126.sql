-- Authorized cohort of twenty; review and apply before deploying the companion route.
-- No dispatch, counter reset, source rewrite, or human-review update.
begin;
create schema if not exists vision360_batch_private;
revoke all on schema vision360_batch_private from public,anon,authenticated;
grant usage on schema vision360_batch_private to service_role;
create table vision360_batch_private.control(singleton boolean primary key default true check(singleton),enabled boolean not null default true,daily_cap integer not null default 20 check(daily_cap between 1 and 10000));
insert into vision360_batch_private.control default values;
create table vision360_batch_private.cohort(ticket_id text primary key,source_hash text not null,analyst_id uuid not null,team_id uuid not null,occurred_date date not null,satisfaction_label text not null check(satisfaction_label in ('positive','negative')),rated_at timestamptz not null,last_message_id text not null);
insert into vision360_batch_private.cohort values ('1093401','d5d400262b1d93e2268058c2255137018bc53fe93e6fb51ad9dee9868609cb6f','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-13','negative','2026-11-16 12:36:00+00','4026434'),
('1092857','c8cf622a063ed6feedc55a3642cbaec8a86b0e3c14e3adc862b94a302cb76033','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-12','negative','2026-11-12 13:21:00+00','3999221'),
('1094762','652a27e689bd1eec03baa2eab0ae963a77026c45c24be44c605d0ce6a72d705f','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-13','negative','2026-11-13 14:42:00+00','4020684'),
('1088556','5725f758902379c074ddf85014270870af9b4a5d1a87d3631e4a1d3a9ba870f3','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-06','negative','2026-11-06 14:30:00+00','3919781'),
('1092484','b6fa77fd7665b1c573a06d7308ef1457d8417a1eb64fb70f3f7f09cb30bd5720','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-11','negative','2026-11-11 13:17:00+00','3979274'),
('1085727','d0d4cc9e2f36440df99520df397028e8b7c4fd6b6112d32fc4391cc6596e9d4a','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-04','negative','2026-11-05 18:30:00+00','3874641'),
('1085038','94336f2ee8cf7bf02f894fcd1ed7d5191193a48508bfc220b2da5ade7f20c0f6','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-04','negative','2026-11-04 19:38:00+00','3867307'),
('1086522','4f8e9bdc62acab52b241c99f129b06e81adc82db5b6e80c05421b4b4ceaee5f9','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-05','negative','2026-11-05 14:34:00+00','3886596'),
('1097756','03703be06bc09a8504554d115b726dc2233917e7d1b977cb476c83f9229e31f7','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-17','positive','2026-11-17 20:09:00+00','4063193'),
('1083324','46e05da9bf9a8f642b1d7c82c9abc1df1b77b57661bd1fa501c31000edc9a419','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-03','negative','2026-11-04 13:17:00+00','3847454'),
('1097741','ce69a8075d77b58b3f0fe67b8375d4bc9dff27b7b3084b62179d01340cf8e0a8','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-17','positive','2026-11-17 16:33:00+00','4061517'),
('1098046','64328f1881d3e0cc8c3b218f0ef62ff662e7dd5b989139909346f0f4a2c77969','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-18','positive','2026-11-18 21:01:00+00','4087268'),
('1097337','65f5e7eb0b085364f97a1af7394cde84a22a2578a863c81698baaba9f5e504ad','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-17','positive','2026-11-17 13:48:00+00','4056943'),
('1098236','bd3ecd72bbfb29e0421f3aea7353b87cef8de048d9a1f2677187386a184320bf','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-18','positive','2026-11-18 20:24:00+00','4086386'),
('1096736','a549ddb3855b611a93ae82d1c2c00fd0c08de0582b01dc03123acd764536b625','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-16','positive','2026-11-16 19:20:00+00','4049160'),
('1098548','40e162f98ac682c9d4a774b5f2f7ab2991a4bfe99dafd05ae61040ea9c7d631c','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-18','positive','2026-11-18 13:35:00+00','4074233'),
('1095970','a60db62b032218599df05501b0837baef60adef3ec9a1465331bf77568875f38','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-16','positive','2026-11-16 19:00:00+00','4048349'),
('1098557','5334df14eef8f55b2e1fe8af34e1da753ecc7118e8b7d5293d355981e1b2e67e','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-18','positive','2026-11-18 13:15:00+00','4073525'),
('1096509','d4a4bb242e4fd48480a6b9cb30b84eaba200a96b626cdf4ae9528a27865977a4','66708884-2ba6-4a19-bfa3-3db1276dc82e','dc039139-7bec-4271-a27a-38a32959a892','2026-11-16','positive','2026-11-16 15:59:00+00','4042948'),
('1098478','79602fdb8e47efa27a8d26b32fc305e2df5fea12e8fe9c1310abdc4c1870f924','598d5aec-15c8-4504-85f7-4521c1a040fc','6a9ad22d-7c6f-48e0-98bc-60561dcc8008','2026-11-18','positive','2026-11-18 12:25:00+00','4071861');
create table vision360_batch_private.attempts(lease_token uuid primary key,ticket_id text not null references vision360_batch_private.cohort,attempt_no integer not null check(attempt_no between 1 and 3),started_at timestamptz not null default clock_timestamp(),started_day date not null,status text not null check(status in ('processing','done','failed')),settled_at timestamptz,error_code text,unique(ticket_id,attempt_no));
alter table vision360_batch_private.control enable row level security;
alter table vision360_batch_private.cohort enable row level security;
alter table vision360_batch_private.attempts enable row level security;
revoke all on all tables in schema vision360_batch_private from public,anon,authenticated;
grant select,update on vision360_batch_private.control to service_role;
grant select on vision360_batch_private.cohort to service_role;
grant select,insert,update on vision360_batch_private.attempts to service_role;
create function vision360_batch_private.record_settlement() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if old.status='processing' and old.lease_token is not null and new.status<>'processing' then
  update vision360_batch_private.attempts set status=case when new.status='done' then 'done' else 'failed' end,settled_at=clock_timestamp(),error_code=case when new.error_code ~ '^[a-z0-9_:]{1,120}$' then new.error_code else null end where lease_token=old.lease_token and ticket_id=old.ticket_id and status='processing';
 end if;
 return new;
end $fn$;
revoke all on function vision360_batch_private.record_settlement() from public,anon,authenticated;
create trigger vision360_batch_settlement after update on public.clickdesk_360_work_queue for each row execute function vision360_batch_private.record_settlement();
create function public.claim_vision360_batch20_work(p_ticket text,p_rating_hash text) returns setof public.clickdesk_360_work_queue language plpgsql security invoker set search_path='' as $fn$
declare c vision360_batch_private.cohort; ctl vision360_batch_private.control; w public.clickdesk_360_work_queue; successes integer; failures integer; used integer; token uuid; today date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 perform pg_advisory_xact_lock(hashtext('vision360-batch20-20261126'));
 select * into ctl from vision360_batch_private.control where singleton for update;
 if not found or not ctl.enabled then return; end if;
 select * into c from vision360_batch_private.cohort where ticket_id=p_ticket;
 if not found or c.source_hash is distinct from p_rating_hash then return;end if;
 update public.clickdesk_360_work_queue q set status='failed',error_code='worker_lease_expired',lease_token=null,lease_until=null,updated_at=clock_timestamp() where q.status='processing' and q.lease_until<clock_timestamp() and exists(select 1 from vision360_batch_private.attempts a where a.ticket_id=q.ticket_id and a.lease_token=q.lease_token and a.status='processing');
 if exists(select 1 from public.clickdesk_360_work_queue q join vision360_batch_private.cohort m using(ticket_id) where q.status='processing') or exists(select 1 from vision360_batch_private.attempts where status='processing') then return;end if;
 select count(*) filter(where status='done'),count(*) filter(where status='failed') into successes,failures from vision360_batch_private.attempts;
 if failures>0 and failures*10>(successes+failures)*3 then return;end if;
 select count(*) into used from vision360_batch_private.attempts where started_day=today;
 if used>=ctl.daily_cap then return;end if;
 select * into w from public.clickdesk_360_work_queue where ticket_id=p_ticket for update;
 if not found or w.analyst_id<>c.analyst_id or w.team_id<>c.team_id or w.occurred_date<>c.occurred_date or w.satisfaction_label<>c.satisfaction_label or w.attempts>=3 or w.lease_token is not null or w.next_attempt_at>clock_timestamp() or w.status not in ('pending','failed') or (w.error_code is not null and w.error_code not in ('provider_timeout','provider_http_429','provider_http_500','provider_http_502','provider_http_503','provider_http_504','worker_lease_expired')) then return;end if;
 if exists(select 1 from public.clickdesk_qualitative_analyses where clickdesk_ticket_id=p_ticket) or exists(select 1 from public.clickdesk_final_ticket_pending where ticket_id=p_ticket) or not exists(select 1 from public.chat_analysts where id=c.analyst_id and team_id=c.team_id and active) or not exists(select 1 from public.clickdesk_event_ratings r where r.ticket_id=p_ticket and r.source_hash=c.source_hash and r.analyst_id=c.analyst_id and r.team_id=c.team_id and r.rated_at=c.rated_at) or not exists(select 1 from public.clickdesk_final_ticket_ledger l where l.ticket_id=p_ticket and l.analyst_id=c.analyst_id and l.team_id=c.team_id and l.occurred_date=c.occurred_date and l.satisfaction_label=c.satisfaction_label and l.last_public_message_id=c.last_message_id and l.rating_timestamp_warning=false and l.last_public_at<date_trunc('minute',c.rated_at)) then return;end if;
 token:=gen_random_uuid();
 insert into vision360_batch_private.attempts(lease_token,ticket_id,attempt_no,started_day,status) values(token,p_ticket,w.attempts+1,today,'processing');
 return query update public.clickdesk_360_work_queue q set status='processing',attempts=q.attempts+1,lease_token=token,lease_until=clock_timestamp()+interval '5 minutes',error_code=null,updated_at=clock_timestamp() where q.ticket_id=p_ticket and q.status=w.status and q.attempts=w.attempts and q.lease_token is null returning q.*;
end $fn$;
revoke all on function public.claim_vision360_batch20_work(text,text) from public,anon,authenticated;
grant execute on function public.claim_vision360_batch20_work(text,text) to service_role;
CREATE OR REPLACE FUNCTION public.finish_clickdesk_360_activation(p_ticket text, p_lease uuid, p_analysis jsonb, p_model text, p_hash text, p_characters integer, p_rating_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.clickdesk_360_work_queue; l public.clickdesk_final_ticket_ledger; n integer;
begin
 if p_ticket not in ('1093401','1092857','1094762','1088556','1092484','1085727','1085038','1086522','1097756','1083324','1097741','1098046','1097337','1098236','1096736','1098548','1095970','1098557','1096509','1098478') then return false;end if;
 if p_rating_hash is distinct from (case p_ticket
 when '1093401' then 'd5d400262b1d93e2268058c2255137018bc53fe93e6fb51ad9dee9868609cb6f'
 when '1092857' then 'c8cf622a063ed6feedc55a3642cbaec8a86b0e3c14e3adc862b94a302cb76033'
 when '1094762' then '652a27e689bd1eec03baa2eab0ae963a77026c45c24be44c605d0ce6a72d705f'
 when '1088556' then '5725f758902379c074ddf85014270870af9b4a5d1a87d3631e4a1d3a9ba870f3'
 when '1092484' then 'b6fa77fd7665b1c573a06d7308ef1457d8417a1eb64fb70f3f7f09cb30bd5720'
 when '1085727' then 'd0d4cc9e2f36440df99520df397028e8b7c4fd6b6112d32fc4391cc6596e9d4a'
 when '1085038' then '94336f2ee8cf7bf02f894fcd1ed7d5191193a48508bfc220b2da5ade7f20c0f6'
 when '1086522' then '4f8e9bdc62acab52b241c99f129b06e81adc82db5b6e80c05421b4b4ceaee5f9'
 when '1097756' then '03703be06bc09a8504554d115b726dc2233917e7d1b977cb476c83f9229e31f7'
 when '1083324' then '46e05da9bf9a8f642b1d7c82c9abc1df1b77b57661bd1fa501c31000edc9a419'
 when '1097741' then 'ce69a8075d77b58b3f0fe67b8375d4bc9dff27b7b3084b62179d01340cf8e0a8'
 when '1098046' then '64328f1881d3e0cc8c3b218f0ef62ff662e7dd5b989139909346f0f4a2c77969'
 when '1097337' then '65f5e7eb0b085364f97a1af7394cde84a22a2578a863c81698baaba9f5e504ad'
 when '1098236' then 'bd3ecd72bbfb29e0421f3aea7353b87cef8de048d9a1f2677187386a184320bf'
 when '1096736' then 'a549ddb3855b611a93ae82d1c2c00fd0c08de0582b01dc03123acd764536b625'
 when '1098548' then '40e162f98ac682c9d4a774b5f2f7ab2991a4bfe99dafd05ae61040ea9c7d631c'
 when '1095970' then 'a60db62b032218599df05501b0837baef60adef3ec9a1465331bf77568875f38'
 when '1098557' then '5334df14eef8f55b2e1fe8af34e1da753ecc7118e8b7d5293d355981e1b2e67e'
 when '1096509' then 'd4a4bb242e4fd48480a6b9cb30b84eaba200a96b626cdf4ae9528a27865977a4'
 when '1098478' then '79602fdb8e47efa27a8d26b32fc305e2df5fea12e8fe9c1310abdc4c1870f924' end) then return false;end if;
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
$function$;
commit;

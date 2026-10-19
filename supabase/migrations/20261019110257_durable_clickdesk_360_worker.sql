
create table public.clickdesk_360_work_queue (
 ticket_id text primary key,
 analyst_id uuid not null, team_id uuid not null, occurred_date date not null,
 satisfaction_label text not null check(satisfaction_label in ('positive','negative')),
 status text not null default 'pending' check(status in ('pending','processing','done','failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
 error_code text, completed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.clickdesk_360_work_queue enable row level security;
revoke all on public.clickdesk_360_work_queue from anon, authenticated;
grant select on public.clickdesk_360_work_queue to authenticated;
grant all on public.clickdesk_360_work_queue to service_role;
create policy management_read_360_work_queue on public.clickdesk_360_work_queue for select to authenticated
 using ((select public.is_management_user()));
create index clickdesk_360_work_due on public.clickdesk_360_work_queue(status,next_attempt_at);
create table public.clickdesk_360_worker_health (
 singleton boolean primary key default true check(singleton),
 last_started_at timestamptz, last_finished_at timestamptz,
 processed integer not null default 0, failed integer not null default 0,
 status text not null default 'not_configured', error_code text
);
alter table public.clickdesk_360_worker_health enable row level security;
revoke all on public.clickdesk_360_worker_health from anon, authenticated;
grant select on public.clickdesk_360_worker_health to authenticated;
grant all on public.clickdesk_360_worker_health to service_role;
create policy management_read_360_worker_health on public.clickdesk_360_worker_health for select to authenticated
 using ((select public.is_management_user()));
insert into public.clickdesk_360_worker_health(singleton) values(true);
create table public.clickdesk_360_requests (
 id uuid primary key default gen_random_uuid(), start_date date not null, end_date date not null,
 team_id uuid, requested_by uuid, created_at timestamptz not null default now(),
 check(end_date>=start_date and end_date-start_date<=92)
);
alter table public.clickdesk_360_requests enable row level security;
revoke all on public.clickdesk_360_requests from anon, authenticated;
grant select on public.clickdesk_360_requests to authenticated;
grant all on public.clickdesk_360_requests to service_role;
create policy management_read_360_requests on public.clickdesk_360_requests for select to authenticated
 using ((select public.is_management_user()));

-- Service-only: these functions are never available through a browser session.
create function public.configure_clickdesk_360_worker(p_api_key text, p_model text)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if length(p_api_key)<20 or length(p_api_key)>512 then raise exception 'Invalid provider configuration'; end if;
 select id into sid from vault.secrets where name='clickdesk_360_google_api_key';
 if sid is null then perform vault.create_secret(p_api_key,'clickdesk_360_google_api_key','Provider da IA qualitativa exclusiva da homologação');
 else perform vault.update_secret(sid,p_api_key); end if;
 select id into sid from vault.secrets where name='clickdesk_360_google_model';
 if sid is null then perform vault.create_secret(coalesce(nullif(p_model,''),'gemini-3.5-flash-lite'),'clickdesk_360_google_model','Modelo já configurado na aplicação de homologação');
 else perform vault.update_secret(sid,coalesce(nullif(p_model,''),'gemini-3.5-flash-lite')); end if;
end $$;
create function public.get_clickdesk_360_worker_config()
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'api_key',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_api_key'),
 'account_id',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_account_id'),
 'google_api_key',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_360_google_api_key'),
 'model',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_360_google_model'));
$$;
create function public.refresh_clickdesk_360_queue(p_start date,p_end date,p_team uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 select l.ticket_id,l.analyst_id,l.team_id,l.occurred_date,l.satisfaction_label
 from public.clickdesk_final_ticket_ledger l
 join public.chat_analysts a on a.id=l.analyst_id and a.active
 left join public.clickdesk_qualitative_analyses q on q.clickdesk_ticket_id=l.ticket_id
  and q.analyst_id=l.analyst_id and q.occurred_date=l.occurred_date and q.satisfaction_label=l.satisfaction_label
 where l.occurred_date between p_start and p_end and (p_team is null or l.team_id=p_team)
 and l.satisfaction_label in ('positive','negative')
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=l.ticket_id)
 and not (q.id is not null and (q.validation_status='rejected' or coalesce(q.analysis->>'_analysis_version','0') ~ '^[0-9]+$'
    and coalesce(q.analysis->>'_analysis_version','0')::integer>=2))
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,
 occurred_date=excluded.occurred_date,satisfaction_label=excluded.satisfaction_label,
 status='pending',attempts=0,lease_token=null,lease_until=null,next_attempt_at=now(),error_code=null,updated_at=now()
 where clickdesk_360_work_queue.analyst_id is distinct from excluded.analyst_id
 or clickdesk_360_work_queue.satisfaction_label is distinct from excluded.satisfaction_label
 or clickdesk_360_work_queue.occurred_date is distinct from excluded.occurred_date
 or clickdesk_360_work_queue.status='done';
 get diagnostics affected=row_count;
 -- Cache reuse and editorial discard never produce another provider call.
 update public.clickdesk_360_work_queue w set status='done',lease_token=null,lease_until=null,
 completed_at=coalesce(w.completed_at,now()),updated_at=now()
 where w.status in ('pending','failed') and exists(
 select 1 from public.clickdesk_qualitative_analyses q where q.clickdesk_ticket_id=w.ticket_id
 and q.analyst_id=w.analyst_id and q.occurred_date=w.occurred_date and q.satisfaction_label=w.satisfaction_label
 and (q.validation_status='rejected' or coalesce(q.analysis->>'_analysis_version','0')::integer>=2));
 return affected;
end $$;
create function public.claim_clickdesk_360_work(p_limit integer default 4)
returns setof public.clickdesk_360_work_queue language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('clickdesk_360_claim'));
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
 limit least(greatest(p_limit,1),greatest(0,4-(select count(*)::integer from public.clickdesk_360_work_queue where status='processing')))
 ) update public.clickdesk_360_work_queue w set status='processing',attempts=w.attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '150 seconds',updated_at=now()
 from picked p where w.ticket_id=p.ticket_id returning w.*;
end $$;
revoke all on function public.configure_clickdesk_360_worker(text,text) from public,anon,authenticated;
revoke all on function public.get_clickdesk_360_worker_config() from public,anon,authenticated;
revoke all on function public.refresh_clickdesk_360_queue(date,date,uuid) from public,anon,authenticated;
revoke all on function public.claim_clickdesk_360_work(integer) from public,anon,authenticated;
grant execute on function public.configure_clickdesk_360_worker(text,text) to service_role;
grant execute on function public.get_clickdesk_360_worker_config() to service_role;
grant execute on function public.refresh_clickdesk_360_queue(date,date,uuid) to service_role;
grant execute on function public.claim_clickdesk_360_work(integer) to service_role;

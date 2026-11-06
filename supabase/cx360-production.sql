-- Additive production module. Existing performance tables and calculations are unchanged.
begin;
create schema if not exists cx360_private;
revoke all on schema cx360_private from public, anon, authenticated;
create table public.cx360_cases (
  id uuid primary key default gen_random_uuid(),
  ticket_source text not null check(ticket_source in ('clickdesk','zendesk','telefone')),
  ticket_id text not null check(length(btrim(ticket_id)) between 1 and 100),
  team_id uuid not null references public.chat_teams(id),
  title text not null check(length(btrim(title)) between 5 and 200),
  observation text not null check(length(btrim(observation)) between 10 and 3000),
  evidence text not null check(length(btrim(evidence)) between 10 and 3000),
  hypothesis text not null default '' check(length(hypothesis)<=3000),
  impact text not null default '' check(length(impact)<=3000),
  status text not null default 'identificado' check(status in ('identificado','em_investigacao','aguardando_validacao','acao_definida','em_acompanhamento','concluido','inconclusivo')),
  action text not null default '' check(length(action)<=3000),
  owner_id uuid not null references public.profiles(id),
  review_date date,
  decision_notes text not null default '' check(length(decision_notes)<=3000),
  outcome text not null default '' check(length(outcome)<=3000),
  approval_requested boolean not null default false,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(ticket_source,ticket_id,team_id)
);
create index cx360_cases_team_updated on public.cx360_cases(team_id,updated_at desc);
create index cx360_cases_owner on public.cx360_cases(owner_id);
create index cx360_cases_approver on public.cx360_cases(approved_by);
create table public.cx360_events (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references public.cx360_cases(id),
  actor_id uuid not null references public.profiles(id), occurred_at timestamptz not null default now(),
  before_state jsonb, after_state jsonb not null
);
create index cx360_events_case_time on public.cx360_events(case_id,occurred_at);
create index cx360_events_actor on public.cx360_events(actor_id);
alter table public.cx360_cases enable row level security;
alter table public.cx360_events enable row level security;
revoke all on public.cx360_cases,public.cx360_events from public,anon,authenticated;
grant select,insert,update on public.cx360_cases to authenticated;
grant select on public.cx360_events to authenticated;
create policy cx360_management_read on public.cx360_cases for select to authenticated using ((select public.is_management_user()));
create policy cx360_management_insert on public.cx360_cases for insert to authenticated with check ((select public.is_management_user()));
create policy cx360_management_update on public.cx360_cases for update to authenticated using ((select public.is_management_user())) with check ((select public.is_management_user()));
create policy cx360_management_history on public.cx360_events for select to authenticated using ((select public.is_management_user()));
create function cx360_private.validate_case() returns trigger language plpgsql security invoker set search_path='' as $$
declare allowed text[];
begin
  if auth.uid() is null or not public.is_management_user() then raise exception 'Management access required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=new.owner_id and role::text in ('master','coordenadora')) then raise exception 'Owner must be an authorized manager'; end if;
  if tg_op='INSERT' then
    if new.status<>'identificado' or new.approved_by is not null or new.approved_at is not null or new.approval_requested then raise exception 'Investigation required before approval'; end if;
    new.version:=1; new.created_at:=now();
  else
    if (new.id,new.ticket_source,new.ticket_id,new.team_id,new.title,new.observation,new.evidence,new.hypothesis,new.impact,new.created_at)
      is distinct from (old.id,old.ticket_source,old.ticket_id,old.team_id,old.title,old.observation,old.evidence,old.hypothesis,old.impact,old.created_at) then raise exception 'Original evidence is immutable; add investigation results to decision notes'; end if;
    if old.status='concluido' then raise exception 'Completed cases are immutable'; end if;
    if new.status<>old.status then
      allowed:=case old.status
        when 'identificado' then array['em_investigacao','inconclusivo']
        when 'em_investigacao' then array['aguardando_validacao','inconclusivo']
        when 'aguardando_validacao' then array['em_investigacao','acao_definida','inconclusivo']
        when 'acao_definida' then array['em_acompanhamento','em_investigacao','inconclusivo']
        when 'em_acompanhamento' then array['concluido','em_investigacao','inconclusivo']
        when 'inconclusivo' then array['em_investigacao'] else array[]::text[] end;
      if not new.status=any(allowed) then raise exception 'Invalid transition'; end if;
    end if;
    if old.approved_by is not null and new.status<>'em_investigacao' and (new.action,new.owner_id,new.review_date) is distinct from (old.action,old.owner_id,old.review_date) then raise exception 'Reopen investigation before revising an approved action'; end if;
    new.approved_by:=old.approved_by; new.approved_at:=old.approved_at;
    if new.status='em_investigacao' then new.approved_by:=null; new.approved_at:=null; end if;
    new.version:=old.version+1;
  end if;
  if new.status='acao_definida' and old.status is distinct from 'acao_definida' then
    if not new.approval_requested or length(btrim(new.action))=0 or new.review_date is null or length(btrim(new.decision_notes))=0 then raise exception 'Explicit approval, action, review and evidence validation notes required'; end if;
    new.approved_by:=auth.uid(); new.approved_at:=now();
  end if;
  if new.status in ('em_acompanhamento','concluido') and new.approved_by is null then raise exception 'Approval required'; end if;
  if new.status in ('concluido','inconclusivo') and length(btrim(new.outcome))=0 then raise exception 'Closure justification required'; end if;
  new.approval_requested:=false; new.updated_at:=now(); return new;
end $$;
revoke all on function cx360_private.validate_case() from public,anon,authenticated;
create trigger cx360_validate before insert or update on public.cx360_cases for each row execute function cx360_private.validate_case();
-- Only this private trigger may write audit records. No app role can forge or delete them.
create function cx360_private.audit_case() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_management_user() then raise exception 'Management access required'; end if;
  insert into public.cx360_events(case_id,actor_id,before_state,after_state)
    values(new.id,auth.uid(),case when tg_op='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end $$;
revoke all on function cx360_private.audit_case() from public,anon,authenticated;
create trigger cx360_audit after insert or update on public.cx360_cases for each row execute function cx360_private.audit_case();
commit;

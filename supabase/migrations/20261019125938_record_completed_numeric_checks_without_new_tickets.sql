create table public.clickdesk_reconciliation_health(singleton boolean primary key default true check(singleton),last_started_at timestamptz,last_finished_at timestamptz,status text not null default 'idle',examined integer not null default 0,confirmed integer not null default 0,pending integer not null default 0,error_code text);
alter table public.clickdesk_reconciliation_health enable row level security;
revoke all on public.clickdesk_reconciliation_health from public,anon,authenticated;
grant all on public.clickdesk_reconciliation_health to service_role;
create or replace function public.get_clickdesk_sync_clock(p_start date,p_end date)
returns timestamptz language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and (
 lower(p.role::text) in('master','coordenadora','coordinator') or (lower(p.role::text) in('analista','analyst') and p.chat_analyst_id is not null)))
 then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Período inválido.' using errcode='22023'; end if;
 return greatest((select max(finished_at) from public.clickdesk_chat_sync_runs where status='completed' and period_start<=p_end and period_end>=p_start),
 case when p_start<=current_date and p_end>='2026-09-01' then (select last_finished_at from public.clickdesk_reconciliation_health where singleton) else null end);
end $$;
revoke all on function public.get_clickdesk_sync_clock(date,date) from public,anon;
grant execute on function public.get_clickdesk_sync_clock(date,date) to authenticated;
create or replace function public.get_clickdesk_sync_clock(p_start date, p_end date)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and (
      lower(p.role::text) in ('master','coordenadora','coordinator')
      or (lower(p.role::text) in ('analista','analyst') and p.chat_analyst_id is not null)
    )
  ) then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 92 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  return (select max(r.finished_at) from public.clickdesk_chat_sync_runs r
    where r.status='completed' and r.period_start <= p_end and r.period_end >= p_start);
end;
$function$;
revoke all on function public.get_clickdesk_sync_clock(date,date) from public, anon;
grant execute on function public.get_clickdesk_sync_clock(date,date) to authenticated;
comment on function public.get_clickdesk_sync_clock(date,date) is
'Somente horário de sincronização para perfil autorizado; não expõe histórico global nem altera RLS ou KPIs.';

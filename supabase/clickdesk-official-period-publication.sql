-- Homologation only. Scope affects Chat performance, not login or personnel records.
begin;
alter table public.clickdesk_official_period_metrics
  add column if not exists attendance_basis text not null default 'resolved'
  check (attendance_basis in ('received','resolved'));
update public.clickdesk_official_owner_registry
set active = false, updated_at = now()
where source_scope = 'suporte_erp_fiscal'
  and clickdesk_owner_id in (1,12,21,26,57,59,61,77);

create or replace function public.get_scoped_clickdesk_official_period_metrics(p_start date,p_end date)
returns table(source_owner_name text,source_owner_key text,attendances integer,
positive_reviews integer,negative_reviews integer,captured_at timestamptz)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_role text;
  v_analyst_id uuid;
begin
  select lower(coalesce(p.role::text,'')),p.chat_analyst_id into v_role,v_analyst_id
  from public.profiles p where p.id=auth.uid();
  if v_role is null or v_role not in ('master','coordenadora','coordinator','analista','analyst') then
    raise exception 'Perfil sem acesso a indicadores do Chat';
  end if;
  if v_role in ('analista','analyst') and v_analyst_id is null then
    raise exception 'Vínculo de analista não encontrado';
  end if;
  -- Future days must never leak even when the client supplies a different range.
  if p_end >= (now() at time zone 'America/Sao_Paulo')::date then return; end if;
  return query
    select m.source_owner_name,m.source_owner_key,m.attendances,
           m.positive_reviews,m.negative_reviews,m.captured_at
    from public.clickdesk_official_period_metrics m
    join public.clickdesk_official_owner_registry r
      on r.source_scope=m.source_scope and r.source_owner_key=m.source_owner_key and r.active
    join public.chat_analysts a on a.active
      and lower(regexp_replace(translate(trim(a.name),
        'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç',
        'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),
        '[^a-zA-Z0-9]+',' ','g'))=m.source_owner_key
    where m.period_start=p_start and m.period_end=p_end
      and m.source_scope='suporte_erp_fiscal'
      and (m.period_start < date '2026-11-01' or m.attendance_basis='received')
      and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77)
      and (v_role in ('master','coordenadora','coordinator') or a.id=v_analyst_id);
end;
$function$;
revoke all on function public.get_scoped_clickdesk_official_period_metrics(date,date) from public,anon;
grant execute on function public.get_scoped_clickdesk_official_period_metrics(date,date) to authenticated;
commit;

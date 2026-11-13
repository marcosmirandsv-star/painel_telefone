CREATE OR REPLACE FUNCTION public.get_scoped_clickdesk_official_daily_metrics(p_start date, p_end date)
 RETURNS TABLE(occurred_date date, source_owner_name text, source_owner_key text, attendances integer, positive_reviews integer, negative_reviews integer, captured_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare day date;
begin
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>92 or p_end>(now() at time zone 'America/Sao_Paulo')::date then return;end if;
 for day in select generate_series(p_start,p_end,'1 day')::date loop
   return query select day,m.* from public.get_scoped_clickdesk_official_period_metrics(day,day) m;
 end loop;
end $function$;;

CREATE OR REPLACE FUNCTION public.get_scoped_clickdesk_official_period_metrics(p_start date, p_end date)
 RETURNS TABLE(source_owner_name text, source_owner_key text, attendances integer, positive_reviews integer, negative_reviews integer, captured_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_end > (now() at time zone 'America/Sao_Paulo')::date then return; end if;
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
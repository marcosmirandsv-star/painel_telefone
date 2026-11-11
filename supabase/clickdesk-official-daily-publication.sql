-- Homologação only. Reuses the existing per-owner access policy and exclusions.
create or replace function public.get_scoped_clickdesk_official_daily_metrics(p_start date,p_end date)
returns table(occurred_date date,source_owner_name text,source_owner_key text,attendances integer,positive_reviews integer,negative_reviews integer,captured_at timestamptz)
language plpgsql security invoker set search_path='' as $$
declare day date;
begin
 if p_start is null or p_end is null or p_start>p_end or p_end-p_start>92 or p_end>=(now() at time zone 'America/Sao_Paulo')::date then return;end if;
 for day in select generate_series(p_start,p_end,'1 day')::date loop
   return query select day,m.* from public.get_scoped_clickdesk_official_period_metrics(day,day) m;
 end loop;
end $$;
revoke all on function public.get_scoped_clickdesk_official_daily_metrics(date,date) from public,anon;
grant execute on function public.get_scoped_clickdesk_official_daily_metrics(date,date) to authenticated;

-- Preserve leases and provenance, but prioritize recent closed days over the initial backfill.
create or replace function public.cx360_claim(p_start date,p_end date,p_team uuid default null,p_limit integer default 3)
returns setof public.cx360_ratings language sql security invoker set search_path='' as $$
 with picked as (
  select id from public.cx360_ratings where active and eligible
   and rated_day between p_start and least(p_end,((now() at time zone 'America/Sao_Paulo')::date-1))
   and (p_team is null or team_id=p_team) and attempts<3 and next_attempt_at<=now()
   and (status='pending' or (status='processing' and lease_until<now()))
  order by rated_day desc,rated_at,id for update skip locked limit least(greatest(p_limit,1),5)
 ) update public.cx360_ratings r set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 from picked where r.id=picked.id returning r.*;
$$;
revoke all on function public.cx360_claim(date,date,uuid,integer) from public,anon,authenticated;
grant execute on function public.cx360_claim(date,date,uuid,integer) to service_role;

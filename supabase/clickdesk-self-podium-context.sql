-- Contexto seguro de pódio para o portal individual do Chat.
-- Retorna apenas média do time, posição e critérios do próprio analista,
-- sem expor resultados individuais dos colegas.

begin;

create or replace function public.get_clickdesk_self_podium_context(
  p_start date,
  p_end date
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
with own as (
  select public.current_user_chat_analyst_id() as analyst_id
),
own_profile as (
  select ca.id as analyst_id, ca.team_id
  from public.chat_analysts ca
  join own on own.analyst_id = ca.id
),
team_rows as (
  select
    a.analyst_id,
    count(*)::int as attendances,
    count(*) filter (where lower(coalesce(a.satisfaction_label,''))='positive')::int as positive_reviews,
    count(*) filter (where lower(coalesce(a.satisfaction_label,''))='negative')::int as negative_reviews
  from public.clickdesk_chat_attendances a
  join own_profile op on op.team_id = a.team_id
  where a.identity_role='analyst'
    and a.analyst_id is not null
    and a.occurred_date between p_start and p_end
  group by a.analyst_id
),
metrics as (
  select
    analyst_id,
    attendances,
    positive_reviews,
    negative_reviews,
    (positive_reviews + negative_reviews)::int as reviews,
    case
      when positive_reviews + negative_reviews > 0
        then round((positive_reviews::numeric / (positive_reviews + negative_reviews)) * 100, 2)
      else null
    end as csat,
    case
      when attendances > 0
        then round(((positive_reviews + negative_reviews)::numeric / attendances) * 100, 2)
      else null
    end as review_percentage
  from team_rows
),
team_context as (
  select
    count(*)::int as analysts_with_data,
    coalesce(round(avg(attendances)::numeric, 2), 0) as average_attendances
  from metrics
),
ranked as (
  select
    m.*,
    tc.average_attendances,
    (
      coalesce(m.csat,0) >= 90
      and coalesce(m.review_percentage,0) >= 25
      and m.attendances >= tc.average_attendances
    ) as eligible,
    row_number() over (
      order by
        (
          coalesce(m.csat,0) >= 90
          and coalesce(m.review_percentage,0) >= 25
          and m.attendances >= tc.average_attendances
        ) desc,
        coalesce(m.csat,0) desc,
        coalesce(m.review_percentage,0) desc,
        m.attendances desc,
        m.analyst_id
    )::int as position
  from metrics m
  cross join team_context tc
),
self_row as (
  select r.*
  from ranked r
  join own on own.analyst_id = r.analyst_id
)
select jsonb_build_object(
  'team_average_attendances', tc.average_attendances,
  'team_analysts_with_data', tc.analysts_with_data,
  'position', sr.position,
  'total_ranked', tc.analysts_with_data,
  'eligible', coalesce(sr.eligible,false),
  'criteria', jsonb_build_object(
    'csat_min', 90,
    'review_min', 25,
    'volume_min', tc.average_attendances,
    'csat_met', coalesce(sr.csat,0) >= 90,
    'review_met', coalesce(sr.review_percentage,0) >= 25,
    'volume_met', coalesce(sr.attendances,0) >= tc.average_attendances,
    'completed',
      (case when coalesce(sr.csat,0) >= 90 then 1 else 0 end) +
      (case when coalesce(sr.review_percentage,0) >= 25 then 1 else 0 end) +
      (case when coalesce(sr.attendances,0) >= tc.average_attendances then 1 else 0 end)
  )
)
from team_context tc
left join self_row sr on true
$$;

revoke all on function public.get_clickdesk_self_podium_context(date,date) from public, anon;
grant execute on function public.get_clickdesk_self_podium_context(date,date) to authenticated;

commit;

-- Contexto seguro de pódio para o portal individual do Chat.
-- Retorna apenas média do time, posição e critérios do próprio analista,
-- sem expor resultados individuais dos colegas.

begin;

create or replace function public.get_clickdesk_self_official_podium_context(
  p_start date,
  p_end date
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
with own as (
  select public.current_user_chat_analyst_id() as analyst_id
),
own_profile as (
  select ca.id as analyst_id, ca.team_id
  from public.chat_analysts ca
  join own on own.analyst_id = ca.id
),
team_members as (
 select ca.id, r.source_owner_key from public.chat_analysts ca
 join own_profile op on op.team_id=ca.team_id
 join public.clickdesk_official_owner_registry r on r.active and r.source_scope='suporte_erp_fiscal'
 and r.source_owner_key=lower(regexp_replace(translate(trim(ca.name),'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),'[^a-zA-Z0-9]+',' ','g'))
 where ca.active and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77)
),
team_rows as (
 select tm.id analyst_id,m.attendances,m.positive_reviews,m.negative_reviews,
 (select count(*) from public.clickdesk_official_period_votes v
 join public.clickdesk_neutral_reviews n on n.ticket_id=v.ticket_id and n.source_hash=v.source_hash
 where v.period_start=p_start and v.period_end=p_end and v.source_owner_key=tm.source_owner_key
 and v.original_label='Neutro' and v.sentiment='negative' and n.status='verified' and n.exclusion_eligible) excluded_neutrals
 from team_members tm join public.clickdesk_official_period_metrics m on m.source_owner_key=tm.source_owner_key
 and m.source_scope='suporte_erp_fiscal' and m.period_start=p_start and m.period_end=p_end and m.attendance_basis='received'
 where m.attendances>0
),
metrics as (
  select
    analyst_id,
    attendances,
    positive_reviews,
    negative_reviews,
    (positive_reviews + negative_reviews)::int as reviews,
    case
      when positive_reviews + negative_reviews - excluded_neutrals > 0
        then round((positive_reviews::numeric / (positive_reviews + negative_reviews - excluded_neutrals)) * 100, 2)
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
where public.current_user_chat_analyst_id() is not null and p_start<=p_end
and date_trunc('month',p_start)=date_trunc('month',p_end)
and not exists(select 1 from team_members tm where not exists(
 select 1 from public.clickdesk_official_period_metrics m where m.period_start=p_start and m.period_end=p_end
 and m.source_owner_key=tm.source_owner_key and m.source_scope='suporte_erp_fiscal' and m.attendance_basis='received'))
$$;

revoke all on function public.get_clickdesk_self_official_podium_context(date,date) from public, anon;
grant execute on function public.get_clickdesk_self_official_podium_context(date,date) to authenticated;

commit;

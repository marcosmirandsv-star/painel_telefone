alter table public.weekly_team_metrics
  add column if not exists overall_positive_reviews integer,
  add column if not exists overall_negative_reviews integer;

alter table public.weekly_team_metrics
  drop constraint if exists weekly_team_metrics_overall_positive_reviews_check,
  drop constraint if exists weekly_team_metrics_overall_negative_reviews_check;

alter table public.weekly_team_metrics
  add constraint weekly_team_metrics_overall_positive_reviews_check
    check (overall_positive_reviews is null or overall_positive_reviews >= 0),
  add constraint weekly_team_metrics_overall_negative_reviews_check
    check (overall_negative_reviews is null or overall_negative_reviews >= 0);

comment on column public.weekly_team_metrics.overall_positive_reviews is
  'Avaliacoes positivas gerais do telefone, incluindo N1 e N2, no periodo semanal.';

comment on column public.weekly_team_metrics.overall_negative_reviews is
  'Avaliacoes negativas gerais do telefone, incluindo N1 e N2, no periodo semanal.';

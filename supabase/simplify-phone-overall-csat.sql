alter table public.weekly_team_metrics
  add column if not exists overall_csat numeric(5,2);

alter table public.weekly_team_metrics
  drop constraint if exists weekly_team_metrics_overall_csat_check;

alter table public.weekly_team_metrics
  add constraint weekly_team_metrics_overall_csat_check
    check (overall_csat is null or (overall_csat >= 0 and overall_csat <= 100));

comment on column public.weekly_team_metrics.overall_csat is
  'CSAT geral do telefone (N1 e N2) informado semanalmente a partir do 55PBX.';

create table public.clickdesk_chat_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.clickdesk_chat_sync_runs(id) on delete cascade,
  captured_at timestamptz not null default now(),
  period_date date not null,
  department_id integer not null,
  department_name text not null,
  team_id uuid references public.chat_teams(id) on delete set null,

  report_created integer,
  report_resolved integer,
  report_open_now integer,
  report_waiting_now integer,

  agent_received integer,
  agent_resolved integer,
  agent_transferred integer,

  ai_handled integer,
  ai_decided integer,
  ai_resolved_alone integer,
  ai_escalated integer,
  ai_abandoned integer,

  human_answered integer,

  csat_pct numeric(6,2),
  csat_total integer,
  human_csat_pct numeric(6,2),
  human_csat_total integer,

  report_first_response_seconds integer,
  human_response_seconds integer,
  agent_first_response_seconds integer,
  agent_handle_seconds integer,
  resolution_seconds integer,
  ai_time_to_escalate_seconds integer,
  ai_wait_after_seconds integer,

  source_timezone text,
  diagnostics jsonb not null default '{}'::jsonb,

  constraint clickdesk_chat_report_snapshots_run_department_key
    unique (sync_run_id, department_id)
);

create index clickdesk_chat_report_snapshots_period_team_idx
  on public.clickdesk_chat_report_snapshots (period_date, team_id, captured_at desc);

create index clickdesk_chat_report_snapshots_department_time_idx
  on public.clickdesk_chat_report_snapshots (department_id, captured_at desc);

alter table public.clickdesk_chat_report_snapshots enable row level security;

comment on table public.clickdesk_chat_report_snapshots is
  'Hourly homologation snapshots of official ClickDesk support report metrics. Kept separate from human attendance evidence for reconciliation.';
comment on column public.clickdesk_chat_report_snapshots.human_answered is
  'Accumulated human attendances evidenced in clickdesk_chat_attendances for the same date/team at capture time.';
comment on column public.clickdesk_chat_report_snapshots.diagnostics is
  'Non-PII reconciliation metadata and endpoint consistency deltas.';

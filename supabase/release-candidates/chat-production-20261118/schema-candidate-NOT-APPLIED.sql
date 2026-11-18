-- CANDIDATE FOR REVIEW, NOT APPLIED. Production qmetbydkepfdgfqkdkai only.
-- Source: catalog snapshots 18/11/2026. No source data, credentials, users or cron copied.
-- Requires apply_migration after final review and rehearsal, never blanket execution.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
set local check_function_bodies=off;
do $guard$
begin
 if exists(select 1 from public.clickdesk_official_capture_jobs) then
  raise exception 'Unexpected existing Chat capture schema; regenerate the delta';
 end if;
exception when undefined_table then null;
end $guard$;
-- Shared objects: add only the separate nullable Chat link. Preserve Telefone analyst_id.
alter table public.profiles add column chat_analyst_id uuid references public.chat_analysts(id) on delete set null;
create index profiles_chat_analyst_id_idx on public.profiles(chat_analyst_id);
create sequence public."clickdesk_event_corrections_id_seq" as bigint start with 1 increment by 1;
revoke all on sequence public."clickdesk_event_corrections_id_seq" from public,anon,authenticated;
grant usage,select on sequence public."clickdesk_event_corrections_id_seq" to service_role;
create sequence public."clickdesk_neutral_review_attempts_id_seq" as bigint start with 1 increment by 1;
revoke all on sequence public."clickdesk_neutral_review_attempts_id_seq" from public,anon,authenticated;
grant usage,select on sequence public."clickdesk_neutral_review_attempts_id_seq" to service_role;
create sequence public."clickdesk_official_capture_audit_id_seq" as bigint start with 1 increment by 1;
revoke all on sequence public."clickdesk_official_capture_audit_id_seq" from public,anon,authenticated;
grant usage,select on sequence public."clickdesk_official_capture_audit_id_seq" to service_role;

create table public."clickdesk_360_requests" (
 "id" uuid default gen_random_uuid() not null,
 "start_date" date not null,
 "end_date" date not null,
 "team_id" uuid,
 "requested_by" uuid,
 "created_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_360_requests" enable row level security;
revoke all on public."clickdesk_360_requests" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_360_requests" to service_role;

create table public."clickdesk_360_work_queue" (
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "occurred_date" date not null,
 "satisfaction_label" text not null,
 "status" text default 'pending'::text not null,
 "attempts" integer default 0 not null,
 "lease_token" uuid,
 "lease_until" timestamp with time zone,
 "next_attempt_at" timestamp with time zone default now() not null,
 "error_code" text,
 "completed_at" timestamp with time zone,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_360_work_queue" enable row level security;
revoke all on public."clickdesk_360_work_queue" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_360_work_queue" to service_role;

create table public."clickdesk_360_worker_health" (
 "singleton" boolean default true not null,
 "last_started_at" timestamp with time zone,
 "last_finished_at" timestamp with time zone,
 "processed" integer default 0 not null,
 "failed" integer default 0 not null,
 "status" text default 'not_configured'::text not null,
 "error_code" text,
 "cooldown_until" timestamp with time zone
);
alter table public."clickdesk_360_worker_health" enable row level security;
revoke all on public."clickdesk_360_worker_health" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_360_worker_health" to service_role;

create table public."clickdesk_chat_analyst_links" (
 "id" uuid default gen_random_uuid() not null,
 "assignee_key" text not null,
 "assignee_name" text not null,
 "analyst_id" uuid,
 "link_source" text default 'auto_name_match'::text not null,
 "confirmed" boolean default false not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "area_key" text not null,
 "area_name" text not null,
 "team_id" uuid,
 "person_role" text default 'analyst'::text not null
);
alter table public."clickdesk_chat_analyst_links" enable row level security;
revoke all on public."clickdesk_chat_analyst_links" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_analyst_links" to service_role;

create table public."clickdesk_chat_area_links" (
 "area_key" text not null,
 "area_name" text not null,
 "team_id" uuid not null,
 "active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_chat_area_links" enable row level security;
revoke all on public."clickdesk_chat_area_links" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_area_links" to service_role;

create table public."clickdesk_chat_attendances" (
 "id" uuid default gen_random_uuid() not null,
 "clickdesk_ticket_id" text not null,
 "attendance_mode" text default 'human'::text not null,
 "occurred_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "area" text not null,
 "assignee_name" text not null,
 "assignee_key" text not null,
 "analyst_id" uuid,
 "team_id" uuid,
 "satisfaction_label" text,
 "journey_status" text default 'ai_to_human'::text not null,
 "first_seen_at" timestamp with time zone default now() not null,
 "last_seen_at" timestamp with time zone default now() not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "timestamp_source" text default 'unknown'::text not null,
 "identity_role" text default 'unmapped'::text not null
);
alter table public."clickdesk_chat_attendances" enable row level security;
revoke all on public."clickdesk_chat_attendances" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_attendances" to service_role;

create table public."clickdesk_chat_capture_queue" (
 "ticket_id" text not null,
 "period_start" date not null,
 "period_end" date not null,
 "discovered_page" integer not null,
 "status" text default 'pending'::text not null,
 "request_id" bigint,
 "processed_at" timestamp with time zone,
 "last_error" text,
 "discovered_at" timestamp with time zone default now() not null,
 "source_updated_at" timestamp with time zone,
 "attempts" integer default 0 not null,
 "queued_at" timestamp with time zone
);
alter table public."clickdesk_chat_capture_queue" enable row level security;
revoke all on public."clickdesk_chat_capture_queue" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_capture_queue" to service_role;

create table public."clickdesk_chat_daily_resolutions" (
 "id" uuid default gen_random_uuid() not null,
 "resolved_date" date not null,
 "team_id" uuid not null,
 "analyst_id" uuid not null,
 "assignee_name" text not null,
 "area" text not null,
 "resolved_count" integer not null,
 "source" text default 'clickdesk_support_reports_agents'::text not null,
 "source_department_id" integer not null,
 "source_period_start" date not null,
 "source_period_end" date not null,
 "evidence" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_chat_daily_resolutions" enable row level security;
revoke all on public."clickdesk_chat_daily_resolutions" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_daily_resolutions" to service_role;

create table public."clickdesk_chat_report_snapshots" (
 "id" uuid default gen_random_uuid() not null,
 "sync_run_id" uuid not null,
 "captured_at" timestamp with time zone default now() not null,
 "period_date" date not null,
 "department_id" integer not null,
 "department_name" text not null,
 "team_id" uuid,
 "report_created" integer,
 "report_resolved" integer,
 "report_open_now" integer,
 "report_waiting_now" integer,
 "agent_received" integer,
 "agent_resolved" integer,
 "agent_transferred" integer,
 "ai_handled" integer,
 "ai_decided" integer,
 "ai_resolved_alone" integer,
 "ai_escalated" integer,
 "ai_abandoned" integer,
 "human_answered" integer,
 "csat_pct" numeric(6,2),
 "csat_total" integer,
 "human_csat_pct" numeric(6,2),
 "human_csat_total" integer,
 "report_first_response_seconds" integer,
 "human_response_seconds" integer,
 "agent_first_response_seconds" integer,
 "agent_handle_seconds" integer,
 "resolution_seconds" integer,
 "ai_time_to_escalate_seconds" integer,
 "ai_wait_after_seconds" integer,
 "source_timezone" text,
 "diagnostics" jsonb default '{}'::jsonb not null
);
alter table public."clickdesk_chat_report_snapshots" enable row level security;
revoke all on public."clickdesk_chat_report_snapshots" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_report_snapshots" to service_role;

create table public."clickdesk_chat_resolutions" (
 "id" uuid default gen_random_uuid() not null,
 "clickdesk_ticket_id" text not null,
 "resolved_at" timestamp with time zone not null,
 "resolved_date" date not null,
 "area" text not null,
 "assignee_name" text not null,
 "assignee_key" text not null,
 "analyst_id" uuid,
 "team_id" uuid,
 "identity_role" text default 'unmapped'::text not null,
 "source" text default 'ticket_history_reconstruction'::text not null,
 "evidence" jsonb default '{}'::jsonb not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_chat_resolutions" enable row level security;
revoke all on public."clickdesk_chat_resolutions" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_resolutions" to service_role;

create table public."clickdesk_chat_sync_runs" (
 "id" uuid default gen_random_uuid() not null,
 "period_start" date not null,
 "period_end" date not null,
 "trigger_mode" text default 'manual'::text not null,
 "status" text default 'running'::text not null,
 "pages_scanned" integer default 0 not null,
 "rows_received" integer default 0 not null,
 "rows_in_period" integer default 0 not null,
 "rows_target_scope" integer default 0 not null,
 "rows_upserted" integer default 0 not null,
 "matched_rows" integer default 0 not null,
 "unmatched_rows" integer default 0 not null,
 "unmatched_assignees" jsonb default '[]'::jsonb not null,
 "triggered_by" uuid,
 "started_at" timestamp with time zone default now() not null,
 "finished_at" timestamp with time zone,
 "error_message" text,
 "created_at" timestamp with time zone default now() not null,
 "timestamp_audit" jsonb default '{}'::jsonb not null,
 "analyst_rows" integer default 0 not null,
 "management_rows" integer default 0 not null,
 "unmapped_rows" integer default 0 not null
);
alter table public."clickdesk_chat_sync_runs" enable row level security;
revoke all on public."clickdesk_chat_sync_runs" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_sync_runs" to service_role;

create table public."clickdesk_chat_verified_contributions" (
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "analyst_name" text not null,
 "first_message_id" text not null,
 "first_answered_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "satisfaction_label" text,
 "rating_attribution" text default 'unverified'::text not null,
 "evidence_source" text default 'clickdesk_public_agent_message'::text not null,
 "verified_at" timestamp with time zone default now() not null,
 "rating_last_message_id" text,
 "rating_last_answered_at" timestamp with time zone
);
alter table public."clickdesk_chat_verified_contributions" enable row level security;
revoke all on public."clickdesk_chat_verified_contributions" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_chat_verified_contributions" to service_role;

create table public."clickdesk_event_capture_queue" (
 "ticket_id" text not null,
 "source_version" timestamp with time zone not null,
 "status" text default 'pending'::text not null,
 "attempts" integer default 0 not null,
 "lease_until" timestamp with time zone,
 "lease_token" uuid,
 "next_attempt_at" timestamp with time zone default now() not null,
 "error_code" text,
 "captured_at" timestamp with time zone
);
alter table public."clickdesk_event_capture_queue" enable row level security;
revoke all on public."clickdesk_event_capture_queue" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_capture_queue" to service_role;

create table public."clickdesk_event_corrections" (
 "id" bigint generated always as identity not null,
 "ticket_id" text not null,
 "kind" text not null,
 "previous" jsonb not null,
 "proposed" jsonb not null,
 "source_hash" text not null,
 "detected_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_event_corrections" enable row level security;
revoke all on public."clickdesk_event_corrections" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_corrections" to service_role;

create table public."clickdesk_event_published_daily" (
 "occurred_date" date not null,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "attendances" integer not null,
 "positive_reviews" integer not null,
 "negative_reviews" integer not null,
 "excluded_neutrals" integer default 0 not null,
 "neutral_human" integer default 0 not null,
 "neutral_external" integer default 0 not null,
 "neutral_pending" integer default 0 not null,
 "captured_at" timestamp with time zone not null
);
alter table public."clickdesk_event_published_daily" enable row level security;
revoke all on public."clickdesk_event_published_daily" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_published_daily" to service_role;

create table public."clickdesk_event_ratings" (
 "ticket_id" text not null,
 "ticket_number" text,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "rated_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "sentiment" text not null,
 "original_label" text not null,
 "source_hash" text not null,
 "captured_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_event_ratings" enable row level security;
revoke all on public."clickdesk_event_ratings" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_ratings" to service_role;

create table public."clickdesk_event_receipts" (
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "event_id" text not null,
 "received_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "department" text not null,
 "recorded_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_event_receipts" enable row level security;
revoke all on public."clickdesk_event_receipts" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_receipts" to service_role;

create table public."clickdesk_event_sync_health" (
 "singleton" boolean default true not null,
 "started_at" timestamp with time zone,
 "finished_at" timestamp with time zone,
 "status" text default 'pending'::text not null,
 "error_code" text,
 "ratings_start" date,
 "ratings_end" date,
 "ratings_complete" boolean default false not null
);
alter table public."clickdesk_event_sync_health" enable row level security;
revoke all on public."clickdesk_event_sync_health" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_sync_health" to service_role;

create table public."clickdesk_event_ticket_history" (
 "ticket_id" text not null,
 "source_version" timestamp with time zone not null,
 "events" jsonb not null,
 "captured_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_event_ticket_history" enable row level security;
revoke all on public."clickdesk_event_ticket_history" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_event_ticket_history" to service_role;

create table public."clickdesk_final_coverage" (
 "source_key" text not null,
 "start_date" date not null,
 "end_date" date not null,
 "candidate_count" integer not null,
 "confirmed_count" integer not null,
 "pending_count" integer not null,
 "completeness" text not null,
 "evidence_hash" text,
 "verified_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_final_coverage" enable row level security;
revoke all on public."clickdesk_final_coverage" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_final_coverage" to service_role;

create table public."clickdesk_final_ticket_ledger" (
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "team_id" uuid not null,
 "last_public_message_id" text not null,
 "last_public_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "area" text,
 "satisfaction_label" text,
 "rating_timestamp_warning" boolean default false not null,
 "evidence_source" text not null,
 "evidence_version" text,
 "verified_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_final_ticket_ledger" enable row level security;
revoke all on public."clickdesk_final_ticket_ledger" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_final_ticket_ledger" to service_role;

create table public."clickdesk_final_ticket_pending" (
 "ticket_id" text not null,
 "reason" text not null,
 "evidence_source" text not null,
 "checked_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_final_ticket_pending" enable row level security;
revoke all on public."clickdesk_final_ticket_pending" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_final_ticket_pending" to service_role;

create table public."clickdesk_inventory_assessment" (
 "period_key" text not null,
 "candidate_count" integer not null,
 "confirmed_count" integer not null,
 "excluded_count" integer not null,
 "pending_count" integer not null,
 "included_period_count" integer not null,
 "reasons" jsonb not null,
 "source_hash" text not null,
 "complete" boolean not null,
 "assessed_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_inventory_assessment" enable row level security;
revoke all on public."clickdesk_inventory_assessment" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_inventory_assessment" to service_role;

create table public."clickdesk_inventory_partition_pages" (
 "partition_id" uuid not null,
 "pass" integer not null,
 "page" integer not null,
 "page_hash" text not null,
 "item_count" integer not null,
 "total_items" integer not null
);
alter table public."clickdesk_inventory_partition_pages" enable row level security;
revoke all on public."clickdesk_inventory_partition_pages" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_inventory_partition_pages" to service_role;

create table public."clickdesk_inventory_partitions" (
 "id" uuid default gen_random_uuid() not null,
 "period_key" text not null,
 "created_from" date not null,
 "created_to" date not null,
 "status" text default 'pending'::text not null,
 "pass" integer default 1 not null,
 "next_page" integer default 1 not null,
 "total_pages" integer,
 "total_items" integer,
 "error_code" text,
 "source_max_updated_at" timestamp with time zone,
 "preflight_hash" text,
 "preflight_verified_at" timestamp with time zone,
 "excluded_before_period" boolean default false not null,
 "preflight_reported_total" integer
);
alter table public."clickdesk_inventory_partitions" enable row level security;
revoke all on public."clickdesk_inventory_partitions" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_inventory_partitions" to service_role;

create table public."clickdesk_neutral_review_attempts" (
 "id" bigint generated always as identity not null,
 "ticket_id" text not null,
 "source_hash" text not null,
 "transcript_hash" text,
 "analysis" jsonb,
 "model" text,
 "error_code" text,
 "created_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_neutral_review_attempts" enable row level security;
revoke all on public."clickdesk_neutral_review_attempts" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_neutral_review_attempts" to service_role;

create table public."clickdesk_neutral_reviews" (
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "cause" text default 'inconclusive'::text not null,
 "status" text default 'pending'::text not null,
 "attempts" integer default 0 not null,
 "source_hash" text not null,
 "transcript_hash" text,
 "analysis" jsonb,
 "exclusion_eligible" boolean default false not null,
 "lease_until" timestamp with time zone,
 "lease_token" uuid,
 "next_attempt_at" timestamp with time zone default now() not null,
 "error_code" text,
 "model" text,
 "reviewed_at" timestamp with time zone,
 "conversation_version" timestamp with time zone
);
alter table public."clickdesk_neutral_reviews" enable row level security;
revoke all on public."clickdesk_neutral_reviews" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_neutral_reviews" to service_role;

create table public."clickdesk_official_capture_audit" (
 "id" bigint generated always as identity not null,
 "period_start" date not null,
 "period_end" date not null,
 "captured_at" timestamp with time zone default now() not null,
 "metrics" jsonb not null,
 "votes" jsonb default '[]'::jsonb not null
);
alter table public."clickdesk_official_capture_audit" enable row level security;
revoke all on public."clickdesk_official_capture_audit" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_capture_audit" to service_role;

create table public."clickdesk_official_capture_jobs" (
 "id" uuid default gen_random_uuid() not null,
 "period_start" date not null,
 "period_end" date not null,
 "owners" integer[] not null,
 "status" text default 'pending'::text not null,
 "created_at" timestamp with time zone default now() not null,
 "published_at" timestamp with time zone,
 "started_at" timestamp with time zone
);
alter table public."clickdesk_official_capture_jobs" enable row level security;
revoke all on public."clickdesk_official_capture_jobs" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_capture_jobs" to service_role;

create table public."clickdesk_official_capture_tasks" (
 "job_id" uuid not null,
 "task_key" text not null,
 "path" text not null,
 "status" text default 'pending'::text not null,
 "attempts" integer default 0 not null,
 "lease_token" uuid,
 "lease_until" timestamp with time zone,
 "next_attempt_at" timestamp with time zone default now() not null,
 "payload" jsonb,
 "completed_at" timestamp with time zone,
 "error_code" text
);
alter table public."clickdesk_official_capture_tasks" enable row level security;
revoke all on public."clickdesk_official_capture_tasks" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_capture_tasks" to service_role;

create table public."clickdesk_official_owner_registry" (
 "clickdesk_owner_id" integer not null,
 "source_owner_name" text not null,
 "source_owner_key" text not null,
 "source_scope" text default 'suporte_erp_fiscal'::text not null,
 "active" boolean default true not null,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_official_owner_registry" enable row level security;
revoke all on public."clickdesk_official_owner_registry" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_owner_registry" to service_role;

create table public."clickdesk_official_period_metrics" (
 "period_start" date not null,
 "period_end" date not null,
 "source_owner_name" text not null,
 "source_owner_key" text not null,
 "attendances" integer default 0 not null,
 "replies" integer default 0 not null,
 "resolved" integer default 0 not null,
 "positive_reviews" integer default 0 not null,
 "negative_reviews" integer default 0 not null,
 "source_scope" text default 'suporte_erp_fiscal'::text not null,
 "captured_at" timestamp with time zone default now() not null,
 "source_note" text default 'ClickDesk official exported snapshot'::text not null,
 "attendance_basis" text default 'resolved'::text not null
);
alter table public."clickdesk_official_period_metrics" enable row level security;
revoke all on public."clickdesk_official_period_metrics" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_period_metrics" to service_role;

create table public."clickdesk_official_period_requests" (
 "period_start" date not null,
 "period_end" date not null,
 "requested_at" timestamp with time zone default now() not null,
 "requested_by" uuid
);
alter table public."clickdesk_official_period_requests" enable row level security;
revoke all on public."clickdesk_official_period_requests" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_period_requests" to service_role;

create table public."clickdesk_official_period_votes" (
 "period_start" date not null,
 "period_end" date not null,
 "ticket_id" text not null,
 "analyst_id" uuid not null,
 "source_owner_key" text not null,
 "ticket_number" text not null,
 "team_id" uuid not null,
 "rated_at" timestamp with time zone not null,
 "occurred_date" date not null,
 "sentiment" text not null,
 "original_label" text not null,
 "source_hash" text not null
);
alter table public."clickdesk_official_period_votes" enable row level security;
revoke all on public."clickdesk_official_period_votes" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_official_period_votes" to service_role;

create table public."clickdesk_period_inventory" (
 "period_key" text not null,
 "start_date" date not null,
 "end_date" date not null,
 "cutoff_date" date not null,
 "status" text default 'pending'::text not null,
 "pass" integer default 1 not null,
 "next_page" integer default 1 not null,
 "total_pages" integer,
 "total_items" integer,
 "started_at" timestamp with time zone default now() not null,
 "finished_at" timestamp with time zone,
 "last_incremental_at" timestamp with time zone,
 "lease_until" timestamp with time zone,
 "error_code" text,
 "retry_count" integer default 0 not null,
 "next_retry_at" timestamp with time zone,
 "scan_watermark_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_period_inventory" enable row level security;
revoke all on public."clickdesk_period_inventory" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_period_inventory" to service_role;

create table public."clickdesk_period_inventory_candidates" (
 "period_key" text not null,
 "ticket_id" text not null,
 "source_updated_at" timestamp with time zone not null,
 "last_seen_pass" integer not null,
 "last_public_at" timestamp with time zone,
 "outside_period_verified_at" timestamp with time zone,
 "outside_period_evidence_hash" text
);
alter table public."clickdesk_period_inventory_candidates" enable row level security;
revoke all on public."clickdesk_period_inventory_candidates" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_period_inventory_candidates" to service_role;

create table public."clickdesk_period_inventory_pages" (
 "period_key" text not null,
 "pass" integer not null,
 "page" integer not null,
 "page_hash" text not null,
 "item_count" integer not null,
 "total_items" integer not null
);
alter table public."clickdesk_period_inventory_pages" enable row level security;
revoke all on public."clickdesk_period_inventory_pages" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_period_inventory_pages" to service_role;

create table public."clickdesk_qualitative_analyses" (
 "id" uuid default gen_random_uuid() not null,
 "clickdesk_ticket_id" text not null,
 "analyst_id" uuid not null,
 "occurred_date" date,
 "area" text,
 "satisfaction_label" text,
 "analysis" jsonb not null,
 "model" text,
 "transcript_hash" text,
 "transcript_characters" integer default 0 not null,
 "created_by" uuid,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null,
 "validation_status" text default 'pending'::text not null,
 "validated_by" uuid,
 "validated_at" timestamp with time zone,
 "validation_notes" text
);
alter table public."clickdesk_qualitative_analyses" enable row level security;
revoke all on public."clickdesk_qualitative_analyses" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_qualitative_analyses" to service_role;

create table public."clickdesk_qualitative_skips" (
 "clickdesk_ticket_id" text not null,
 "analyst_id" uuid,
 "occurred_date" date not null,
 "reason_code" text not null,
 "reason_detail" text,
 "created_at" timestamp with time zone default now() not null,
 "updated_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_qualitative_skips" enable row level security;
revoke all on public."clickdesk_qualitative_skips" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_qualitative_skips" to service_role;

create table public."clickdesk_reconciliation_cycle" (
 "singleton" boolean default true not null,
 "lease_token" uuid,
 "lease_until" timestamp with time zone
);
alter table public."clickdesk_reconciliation_cycle" enable row level security;
revoke all on public."clickdesk_reconciliation_cycle" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_reconciliation_cycle" to service_role;

create table public."clickdesk_reconciliation_health" (
 "singleton" boolean default true not null,
 "last_started_at" timestamp with time zone,
 "last_finished_at" timestamp with time zone,
 "status" text default 'idle'::text not null,
 "examined" integer default 0 not null,
 "confirmed" integer default 0 not null,
 "pending" integer default 0 not null,
 "error_code" text
);
alter table public."clickdesk_reconciliation_health" enable row level security;
revoke all on public."clickdesk_reconciliation_health" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_reconciliation_health" to service_role;

create table public."clickdesk_registry_revision" (
 "singleton" boolean default true not null,
 "changed_at" timestamp with time zone default '1970-01-01 00:00:00+00'::timestamp with time zone not null
);
alter table public."clickdesk_registry_revision" enable row level security;
revoke all on public."clickdesk_registry_revision" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_registry_revision" to service_role;

create table public."clickdesk_source_exclusions" (
 "ticket_id" text not null,
 "reason" text not null,
 "source_deleted_at" timestamp with time zone not null,
 "evidence_hash" text not null,
 "verified_at" timestamp with time zone default now() not null
);
alter table public."clickdesk_source_exclusions" enable row level security;
revoke all on public."clickdesk_source_exclusions" from public,anon,authenticated;
grant select,insert,update,delete on public."clickdesk_source_exclusions" to service_role;
alter table public."clickdesk_360_requests" add constraint "clickdesk_360_requests_pkey" PRIMARY KEY (id);
alter table public."clickdesk_360_work_queue" add constraint "clickdesk_360_work_queue_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_360_worker_health" add constraint "clickdesk_360_worker_health_pkey" PRIMARY KEY (singleton);
alter table public."clickdesk_chat_analyst_links" add constraint "clickdesk_chat_analyst_links_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_area_links" add constraint "clickdesk_chat_area_links_pkey" PRIMARY KEY (area_key);
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_capture_queue" add constraint "clickdesk_chat_capture_queue_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_chat_daily_resolutions" add constraint "clickdesk_chat_daily_resolutions_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_report_snapshots" add constraint "clickdesk_chat_report_snapshots_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_resolutions" add constraint "clickdesk_chat_resolutions_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_sync_runs" add constraint "clickdesk_chat_sync_runs_pkey" PRIMARY KEY (id);
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_pkey" PRIMARY KEY (ticket_id, analyst_id);
alter table public."clickdesk_event_capture_queue" add constraint "clickdesk_event_capture_queue_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_event_corrections" add constraint "clickdesk_event_corrections_pkey" PRIMARY KEY (id);
alter table public."clickdesk_event_published_daily" add constraint "clickdesk_event_published_daily_pkey" PRIMARY KEY (occurred_date, analyst_id);
alter table public."clickdesk_event_ratings" add constraint "clickdesk_event_ratings_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_event_receipts" add constraint "clickdesk_event_receipts_pkey" PRIMARY KEY (ticket_id, analyst_id);
alter table public."clickdesk_event_sync_health" add constraint "clickdesk_event_sync_health_pkey" PRIMARY KEY (singleton);
alter table public."clickdesk_event_ticket_history" add constraint "clickdesk_event_ticket_history_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_pkey" PRIMARY KEY (source_key);
alter table public."clickdesk_final_ticket_ledger" add constraint "clickdesk_final_ticket_ledger_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_final_ticket_pending" add constraint "clickdesk_final_ticket_pending_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_inventory_assessment" add constraint "clickdesk_inventory_assessment_pkey" PRIMARY KEY (period_key);
alter table public."clickdesk_inventory_partition_pages" add constraint "clickdesk_inventory_partition_pages_pkey" PRIMARY KEY (partition_id, pass, page);
alter table public."clickdesk_inventory_partitions" add constraint "clickdesk_inventory_partitions_pkey" PRIMARY KEY (id);
alter table public."clickdesk_neutral_review_attempts" add constraint "clickdesk_neutral_review_attempts_pkey" PRIMARY KEY (id);
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_official_capture_audit" add constraint "clickdesk_official_capture_audit_pkey" PRIMARY KEY (id);
alter table public."clickdesk_official_capture_jobs" add constraint "clickdesk_official_capture_jobs_pkey" PRIMARY KEY (id);
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_pkey" PRIMARY KEY (job_id, task_key);
alter table public."clickdesk_official_owner_registry" add constraint "clickdesk_official_owner_registry_pkey" PRIMARY KEY (clickdesk_owner_id);
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_pkey" PRIMARY KEY (period_start, period_end, source_owner_key, source_scope);
alter table public."clickdesk_official_period_requests" add constraint "clickdesk_official_period_requests_pkey" PRIMARY KEY (period_start, period_end);
alter table public."clickdesk_official_period_votes" add constraint "clickdesk_official_period_votes_pkey" PRIMARY KEY (period_start, period_end, ticket_id);
alter table public."clickdesk_period_inventory" add constraint "clickdesk_period_inventory_pkey" PRIMARY KEY (period_key);
alter table public."clickdesk_period_inventory_candidates" add constraint "clickdesk_period_inventory_candidates_pkey" PRIMARY KEY (period_key, ticket_id);
alter table public."clickdesk_period_inventory_pages" add constraint "clickdesk_period_inventory_pages_pkey" PRIMARY KEY (period_key, pass, page);
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_pkey" PRIMARY KEY (id);
alter table public."clickdesk_qualitative_skips" add constraint "clickdesk_qualitative_skips_pkey" PRIMARY KEY (clickdesk_ticket_id);
alter table public."clickdesk_reconciliation_cycle" add constraint "clickdesk_reconciliation_cycle_pkey" PRIMARY KEY (singleton);
alter table public."clickdesk_reconciliation_health" add constraint "clickdesk_reconciliation_health_pkey" PRIMARY KEY (singleton);
alter table public."clickdesk_registry_revision" add constraint "clickdesk_registry_revision_pkey" PRIMARY KEY (singleton);
alter table public."clickdesk_source_exclusions" add constraint "clickdesk_source_exclusions_pkey" PRIMARY KEY (ticket_id);
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_clickdesk_ticket_id_key" UNIQUE (clickdesk_ticket_id);
alter table public."clickdesk_chat_daily_resolutions" add constraint "clickdesk_chat_daily_resolutions_key" UNIQUE (resolved_date, team_id, analyst_id, area);
alter table public."clickdesk_chat_report_snapshots" add constraint "clickdesk_chat_report_snapshots_run_department_key" UNIQUE (sync_run_id, department_id);
alter table public."clickdesk_chat_resolutions" add constraint "clickdesk_chat_resolutions_ticket_date_area_analyst_key" UNIQUE (clickdesk_ticket_id, resolved_date, area, assignee_key);
alter table public."clickdesk_event_corrections" add constraint "clickdesk_event_corrections_ticket_id_kind_source_hash_key" UNIQUE (ticket_id, kind, source_hash);
alter table public."clickdesk_inventory_partitions" add constraint "clickdesk_inventory_partition_period_key_created_from_creat_key" UNIQUE (period_key, created_from, created_to);
alter table public."clickdesk_official_owner_registry" add constraint "clickdesk_official_owner_registry_source_owner_key_key" UNIQUE (source_owner_key);
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_clickdesk_ticket_id_key" UNIQUE (clickdesk_ticket_id);
alter table public."clickdesk_360_requests" add constraint "clickdesk_360_requests_check" CHECK (((end_date >= start_date) AND ((end_date - start_date) <= 92)));
alter table public."clickdesk_360_work_queue" add constraint "clickdesk_360_work_queue_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 3)));
alter table public."clickdesk_360_work_queue" add constraint "clickdesk_360_work_queue_satisfaction_label_check" CHECK ((satisfaction_label = ANY (ARRAY['positive'::text, 'negative'::text])));
alter table public."clickdesk_360_work_queue" add constraint "clickdesk_360_work_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])));
alter table public."clickdesk_360_worker_health" add constraint "clickdesk_360_worker_health_singleton_check" CHECK (singleton);
alter table public."clickdesk_chat_analyst_links" add constraint "clickdesk_chat_analyst_links_link_source_check" CHECK ((link_source = ANY (ARRAY['auto_name_match'::text, 'manual'::text, 'manager_match'::text, 'unmatched'::text])));
alter table public."clickdesk_chat_analyst_links" add constraint "clickdesk_chat_analyst_links_person_role_check" CHECK ((person_role = ANY (ARRAY['analyst'::text, 'management'::text, 'unmapped'::text, 'apprentice'::text])));
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_attendance_mode_check" CHECK ((attendance_mode = 'human'::text));
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_identity_role_check" CHECK ((identity_role = ANY (ARRAY['analyst'::text, 'management'::text, 'unmapped'::text, 'apprentice'::text])));
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_journey_status_check" CHECK ((journey_status = 'ai_to_human'::text));
alter table public."clickdesk_chat_capture_queue" add constraint "clickdesk_chat_capture_queue_check" CHECK ((period_end >= period_start));
alter table public."clickdesk_chat_capture_queue" add constraint "clickdesk_chat_capture_queue_discovered_page_check" CHECK ((discovered_page >= 1));
alter table public."clickdesk_chat_capture_queue" add constraint "clickdesk_chat_capture_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'done'::text, 'error'::text])));
alter table public."clickdesk_chat_capture_queue" add constraint "clickdesk_chat_capture_queue_ticket_id_check" CHECK ((ticket_id ~ '^[0-9]+$'::text));
alter table public."clickdesk_chat_daily_resolutions" add constraint "clickdesk_chat_daily_resolutions_resolved_count_check" CHECK ((resolved_count >= 0));
alter table public."clickdesk_chat_sync_runs" add constraint "clickdesk_chat_sync_runs_check" CHECK ((period_end >= period_start));
alter table public."clickdesk_chat_sync_runs" add constraint "clickdesk_chat_sync_runs_status_check" CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])));
alter table public."clickdesk_chat_sync_runs" add constraint "clickdesk_chat_sync_runs_trigger_mode_check" CHECK ((trigger_mode = ANY (ARRAY['manual'::text, 'automatic'::text])));
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_evidence_source_check" CHECK ((evidence_source = 'clickdesk_public_agent_message'::text));
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_rating_attribution_check" CHECK ((rating_attribution = ANY (ARRAY['unverified'::text, 'confirmed_resolver'::text, 'last_public_human_answer'::text])));
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_satisfaction_label_check" CHECK ((satisfaction_label = ANY (ARRAY['positive'::text, 'negative'::text])));
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_ticket_id_check" CHECK ((ticket_id ~ '^[0-9]+$'::text));
alter table public."clickdesk_event_capture_queue" add constraint "clickdesk_event_capture_queue_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'complete'::text, 'failed'::text])));
alter table public."clickdesk_event_ratings" add constraint "clickdesk_event_ratings_check" CHECK ((occurred_date = ((rated_at AT TIME ZONE 'America/Sao_Paulo'::text))::date));
alter table public."clickdesk_event_ratings" add constraint "clickdesk_event_ratings_sentiment_check" CHECK ((sentiment = ANY (ARRAY['positive'::text, 'negative'::text])));
alter table public."clickdesk_event_receipts" add constraint "clickdesk_event_receipts_check" CHECK ((occurred_date = ((received_at AT TIME ZONE 'America/Sao_Paulo'::text))::date));
alter table public."clickdesk_event_sync_health" add constraint "clickdesk_event_sync_health_singleton_check" CHECK (singleton);
alter table public."clickdesk_event_ticket_history" add constraint "clickdesk_event_ticket_history_events_check" CHECK ((jsonb_typeof(events) = 'array'::text));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_candidate_count_check" CHECK ((candidate_count >= 0));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_check" CHECK ((end_date >= start_date));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_check1" CHECK (((confirmed_count + pending_count) <= candidate_count));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_completeness_check" CHECK ((completeness = ANY (ARRAY['partial'::text, 'complete'::text])));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_confirmed_count_check" CHECK ((confirmed_count >= 0));
alter table public."clickdesk_final_coverage" add constraint "clickdesk_final_coverage_pending_count_check" CHECK ((pending_count >= 0));
alter table public."clickdesk_final_ticket_ledger" add constraint "clickdesk_final_ledger_message_nonempty" CHECK ((length(btrim(last_public_message_id)) > 0));
alter table public."clickdesk_final_ticket_ledger" add constraint "clickdesk_final_ledger_nonempty_id" CHECK ((length(btrim(ticket_id)) > 0));
alter table public."clickdesk_final_ticket_ledger" add constraint "clickdesk_final_ticket_ledger_satisfaction_label_check" CHECK (((satisfaction_label = ANY (ARRAY['positive'::text, 'negative'::text])) OR (satisfaction_label IS NULL)));
alter table public."clickdesk_final_ticket_pending" add constraint "clickdesk_final_pending_reason_nonempty" CHECK ((length(btrim(reason)) > 0));
alter table public."clickdesk_inventory_partitions" add constraint "clickdesk_inventory_partitions_check" CHECK ((created_to >= created_from));
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_cause_check" CHECK ((cause = ANY (ARRAY['human'::text, 'system'::text, 'other_external'::text, 'mixed'::text, 'inconclusive'::text])));
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_check" CHECK (((NOT exclusion_eligible) OR ((status = 'verified'::text) AND (cause = ANY (ARRAY['system'::text, 'other_external'::text])) AND (transcript_hash IS NOT NULL))));
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'verified'::text, 'needs_review'::text, 'technical_failure'::text])));
alter table public."clickdesk_official_capture_jobs" add constraint "clickdesk_official_capture_jobs_check" CHECK (((period_start <= period_end) AND (date_trunc('month'::text, (period_start)::timestamp with time zone) = date_trunc('month'::text, (period_end)::timestamp with time zone))));
alter table public."clickdesk_official_capture_jobs" add constraint "clickdesk_official_capture_jobs_owners_check" CHECK ((cardinality(owners) > 0));
alter table public."clickdesk_official_capture_jobs" add constraint "clickdesk_official_capture_jobs_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'publishing'::text, 'published'::text, 'failed'::text])));
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_attempts_check" CHECK (((attempts >= 0) AND (attempts <= 5)));
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_check" CHECK (((status = 'complete'::text) = (payload IS NOT NULL)));
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_path_check" CHECK (((path ~~ '/support/reports/agents?%'::text) OR (path ~~ '/support/reports/ratings?%'::text)));
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'failed'::text])));
alter table public."clickdesk_official_owner_registry" add constraint "clickdesk_official_owner_registry_source_scope_check" CHECK ((source_scope = 'suporte_erp_fiscal'::text));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_attendance_basis_check" CHECK ((attendance_basis = ANY (ARRAY['received'::text, 'resolved'::text])));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_attendances_check" CHECK ((attendances >= 0));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_check" CHECK ((period_end >= period_start));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_negative_reviews_check" CHECK ((negative_reviews >= 0));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_positive_reviews_check" CHECK ((positive_reviews >= 0));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_replies_check" CHECK ((replies >= 0));
alter table public."clickdesk_official_period_metrics" add constraint "clickdesk_official_period_metrics_resolved_check" CHECK ((resolved >= 0));
alter table public."clickdesk_official_period_votes" add constraint "clickdesk_official_period_votes_check" CHECK ((period_start <= period_end));
alter table public."clickdesk_official_period_votes" add constraint "clickdesk_official_period_votes_sentiment_check" CHECK ((sentiment = ANY (ARRAY['positive'::text, 'negative'::text])));
alter table public."clickdesk_period_inventory" add constraint "clickdesk_period_inventory_period_key_check" CHECK ((period_key ~ '^20[0-9]{2}-[0-9]{2}$'::text));
alter table public."clickdesk_period_inventory_candidates" add constraint "outside_period_proof_complete" CHECK ((((last_public_at IS NULL) AND (outside_period_verified_at IS NULL) AND (outside_period_evidence_hash IS NULL)) OR ((last_public_at IS NOT NULL) AND (outside_period_verified_at IS NOT NULL) AND (outside_period_evidence_hash IS NOT NULL) AND (outside_period_evidence_hash ~ '^[a-f0-9]{64}$'::text))));
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_analysis_check" CHECK ((jsonb_typeof(analysis) = 'object'::text));
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_transcript_characters_check" CHECK ((transcript_characters >= 0));
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_validation_status_check" CHECK ((validation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public."clickdesk_qualitative_skips" add constraint "clickdesk_qualitative_skips_reason_code_check" CHECK ((reason_code = 'insufficient_transcript'::text));
alter table public."clickdesk_reconciliation_cycle" add constraint "clickdesk_reconciliation_cycle_singleton_check" CHECK (singleton);
alter table public."clickdesk_reconciliation_health" add constraint "clickdesk_reconciliation_health_singleton_check" CHECK (singleton);
alter table public."clickdesk_registry_revision" add constraint "clickdesk_registry_revision_singleton_check" CHECK (singleton);
alter table public."clickdesk_source_exclusions" add constraint "clickdesk_source_exclusions_reason_check" CHECK ((reason = 'deleted_in_source'::text));
alter table public."clickdesk_chat_analyst_links" add constraint "clickdesk_chat_analyst_links_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id) ON DELETE CASCADE;
alter table public."clickdesk_chat_analyst_links" add constraint "clickdesk_chat_analyst_links_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id) ON DELETE SET NULL;
alter table public."clickdesk_chat_area_links" add constraint "clickdesk_chat_area_links_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id) ON DELETE RESTRICT;
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id) ON DELETE SET NULL;
alter table public."clickdesk_chat_attendances" add constraint "clickdesk_chat_attendances_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id) ON DELETE SET NULL;
alter table public."clickdesk_chat_report_snapshots" add constraint "clickdesk_chat_report_snapshots_sync_run_id_fkey" FOREIGN KEY (sync_run_id) REFERENCES clickdesk_chat_sync_runs(id) ON DELETE CASCADE;
alter table public."clickdesk_chat_report_snapshots" add constraint "clickdesk_chat_report_snapshots_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id) ON DELETE SET NULL;
alter table public."clickdesk_chat_sync_runs" add constraint "clickdesk_chat_sync_runs_triggered_by_fkey" FOREIGN KEY (triggered_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id) ON DELETE RESTRICT;
alter table public."clickdesk_chat_verified_contributions" add constraint "clickdesk_chat_verified_contributions_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id) ON DELETE RESTRICT;
alter table public."clickdesk_event_published_daily" add constraint "clickdesk_event_published_daily_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_event_ratings" add constraint "clickdesk_event_ratings_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_event_ratings" add constraint "clickdesk_event_ratings_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id);
alter table public."clickdesk_event_receipts" add constraint "clickdesk_event_receipts_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_event_receipts" add constraint "clickdesk_event_receipts_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id);
alter table public."clickdesk_final_ticket_ledger" add constraint "clickdesk_final_ticket_ledger_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_inventory_assessment" add constraint "clickdesk_inventory_assessment_period_key_fkey" FOREIGN KEY (period_key) REFERENCES clickdesk_period_inventory(period_key);
alter table public."clickdesk_inventory_partition_pages" add constraint "clickdesk_inventory_partition_pages_partition_id_fkey" FOREIGN KEY (partition_id) REFERENCES clickdesk_inventory_partitions(id);
alter table public."clickdesk_inventory_partitions" add constraint "clickdesk_inventory_partitions_period_key_fkey" FOREIGN KEY (period_key) REFERENCES clickdesk_period_inventory(period_key);
alter table public."clickdesk_neutral_review_attempts" add constraint "clickdesk_neutral_review_attempts_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES clickdesk_event_ratings(ticket_id);
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_neutral_reviews" add constraint "clickdesk_neutral_reviews_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES clickdesk_event_ratings(ticket_id);
alter table public."clickdesk_official_capture_tasks" add constraint "clickdesk_official_capture_tasks_job_id_fkey" FOREIGN KEY (job_id) REFERENCES clickdesk_official_capture_jobs(id);
alter table public."clickdesk_official_period_votes" add constraint "clickdesk_official_period_votes_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id);
alter table public."clickdesk_official_period_votes" add constraint "clickdesk_official_period_votes_team_id_fkey" FOREIGN KEY (team_id) REFERENCES chat_teams(id);
alter table public."clickdesk_period_inventory_candidates" add constraint "clickdesk_period_inventory_candidates_period_key_fkey" FOREIGN KEY (period_key) REFERENCES clickdesk_period_inventory(period_key);
alter table public."clickdesk_period_inventory_pages" add constraint "clickdesk_period_inventory_pages_period_key_fkey" FOREIGN KEY (period_key) REFERENCES clickdesk_period_inventory(period_key);
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id) ON DELETE CASCADE;
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."clickdesk_qualitative_analyses" add constraint "clickdesk_qualitative_analyses_validated_by_fkey" FOREIGN KEY (validated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public."clickdesk_qualitative_skips" add constraint "clickdesk_qualitative_skips_analyst_id_fkey" FOREIGN KEY (analyst_id) REFERENCES chat_analysts(id) ON DELETE SET NULL;
CREATE INDEX clickdesk_360_work_due ON public.clickdesk_360_work_queue USING btree (status, next_attempt_at);
CREATE INDEX clickdesk_chat_analyst_links_area_idx ON public.clickdesk_chat_analyst_links USING btree (area_key);
CREATE INDEX clickdesk_chat_analyst_links_team_idx ON public.clickdesk_chat_analyst_links USING btree (team_id);
CREATE UNIQUE INDEX clickdesk_chat_analyst_links_identity_area_uidx ON public.clickdesk_chat_analyst_links USING btree (assignee_key, area_key);
CREATE INDEX clickdesk_chat_analyst_links_analyst_idx ON public.clickdesk_chat_analyst_links USING btree (analyst_id);
CREATE INDEX clickdesk_chat_area_links_team_idx ON public.clickdesk_chat_area_links USING btree (team_id);
CREATE INDEX clickdesk_chat_attendances_identity_role_idx ON public.clickdesk_chat_attendances USING btree (identity_role);
CREATE INDEX clickdesk_chat_attendances_analyst_date_idx ON public.clickdesk_chat_attendances USING btree (analyst_id, occurred_date DESC);
CREATE INDEX clickdesk_chat_attendances_team_date_idx ON public.clickdesk_chat_attendances USING btree (team_id, occurred_date DESC);
CREATE INDEX clickdesk_chat_attendances_assignee_key_idx ON public.clickdesk_chat_attendances USING btree (assignee_key);
CREATE INDEX clickdesk_chat_attendances_date_idx ON public.clickdesk_chat_attendances USING btree (occurred_date DESC);
CREATE INDEX clickdesk_capture_queue_source_updated_idx ON public.clickdesk_chat_capture_queue USING btree (source_updated_at);
CREATE INDEX clickdesk_capture_queue_status_page ON public.clickdesk_chat_capture_queue USING btree (status, discovered_page, ticket_id);
CREATE INDEX clickdesk_chat_daily_resolutions_analyst_date_idx ON public.clickdesk_chat_daily_resolutions USING btree (analyst_id, resolved_date DESC);
CREATE INDEX clickdesk_chat_daily_resolutions_date_idx ON public.clickdesk_chat_daily_resolutions USING btree (resolved_date DESC);
CREATE INDEX clickdesk_chat_report_snapshots_period_team_idx ON public.clickdesk_chat_report_snapshots USING btree (period_date, team_id, captured_at DESC);
CREATE INDEX clickdesk_chat_report_snapshots_department_time_idx ON public.clickdesk_chat_report_snapshots USING btree (department_id, captured_at DESC);
CREATE INDEX clickdesk_chat_resolutions_date_idx ON public.clickdesk_chat_resolutions USING btree (resolved_date DESC);
CREATE INDEX clickdesk_chat_resolutions_analyst_date_idx ON public.clickdesk_chat_resolutions USING btree (analyst_id, resolved_date DESC);
CREATE INDEX clickdesk_chat_resolutions_team_date_idx ON public.clickdesk_chat_resolutions USING btree (team_id, resolved_date DESC);
CREATE INDEX clickdesk_chat_sync_runs_triggered_by_idx ON public.clickdesk_chat_sync_runs USING btree (triggered_by);
CREATE INDEX clickdesk_chat_sync_runs_period_idx ON public.clickdesk_chat_sync_runs USING btree (period_start DESC, period_end DESC);
CREATE UNIQUE INDEX clickdesk_verified_one_rating_per_ticket ON public.clickdesk_chat_verified_contributions USING btree (ticket_id) WHERE (satisfaction_label = ANY (ARRAY['positive'::text, 'negative'::text]));
CREATE INDEX clickdesk_verified_contributions_date_analyst_idx ON public.clickdesk_chat_verified_contributions USING btree (occurred_date, analyst_id);
CREATE INDEX clickdesk_event_receipts_date ON public.clickdesk_event_receipts USING btree (occurred_date, analyst_id);
CREATE INDEX clickdesk_final_ledger_period_team_analyst ON public.clickdesk_final_ticket_ledger USING btree (occurred_date, team_id, analyst_id);
CREATE INDEX clickdesk_final_ledger_owner_period ON public.clickdesk_final_ticket_ledger USING btree (analyst_id, occurred_date);
CREATE UNIQUE INDEX clickdesk_official_one_live_capture ON public.clickdesk_official_capture_jobs USING btree (period_start, period_end) WHERE (status = ANY (ARRAY['pending'::text, 'running'::text, 'publishing'::text]));
CREATE INDEX clickdesk_official_period_metrics_window_idx ON public.clickdesk_official_period_metrics USING btree (period_start, period_end, source_scope);
CREATE INDEX clickdesk_qualitative_analyses_created_by_idx ON public.clickdesk_qualitative_analyses USING btree (created_by);
CREATE INDEX clickdesk_qualitative_analyses_validated_by_idx ON public.clickdesk_qualitative_analyses USING btree (validated_by);
CREATE INDEX clickdesk_qualitative_analyses_analyst_date_idx ON public.clickdesk_qualitative_analyses USING btree (analyst_id, occurred_date DESC);
CREATE INDEX clickdesk_qualitative_analyses_validation_status_idx ON public.clickdesk_qualitative_analyses USING btree (validation_status);

CREATE OR REPLACE FUNCTION public.assess_clickdesk_period_inventory(p_period text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.clickdesk_period_inventory; result jsonb;
begin
 select * into r from public.clickdesk_period_inventory where period_key=p_period;
 if not found then return null; end if;
 with classified as (
 select c.ticket_id,c.source_updated_at,
 case
 when c.outside_period_verified_at>=c.source_updated_at and (c.last_public_at at time zone 'America/Sao_Paulo')::date<r.start_date then 'excluded_last_public_outside_period'
 when p.ticket_id is not null and p.checked_at>=c.source_updated_at then
 case when p.reason in ('no_public_human_answer','final_author_not_in_eligible_registry','final_author_apprentice') then 'excluded_'||p.reason else 'pending_'||p.reason end
 when l.ticket_id is not null and l.verified_at>=c.source_updated_at then 'confirmed'
 else 'pending_source_not_reconciled' end outcome,
 case when l.occurred_date between r.start_date and r.cutoff_date and a.active and p.ticket_id is null then 1 else 0 end included
 from public.clickdesk_period_inventory_candidates c
 left join public.clickdesk_final_ticket_ledger l on l.ticket_id=c.ticket_id
 left join public.chat_analysts a on a.id=l.analyst_id
 left join public.clickdesk_final_ticket_pending p on p.ticket_id=c.ticket_id
 where c.period_key=p_period
 ), counts as (
 select count(*)::int candidate_count,count(*) filter(where outcome='confirmed')::int confirmed_count,
 count(*) filter(where outcome like 'excluded_%')::int excluded_count,
 count(*) filter(where outcome like 'pending_%')::int pending_count,sum(included)::int included_period_count,
 md5(coalesce(string_agg(ticket_id||':'||source_updated_at::text||':'||outcome,'|' order by ticket_id),'')) source_hash
 from classified
 ), saved as (
 insert into public.clickdesk_inventory_assessment(period_key,candidate_count,confirmed_count,excluded_count,pending_count,included_period_count,reasons,source_hash,complete)
 select p_period,c.candidate_count,c.confirmed_count,c.excluded_count,c.pending_count,coalesce(c.included_period_count,0),
 coalesce((select jsonb_object_agg(outcome,n) from(select outcome,count(*) n from classified group by outcome)x),'{}'::jsonb),
 c.source_hash,r.status='complete' and c.pending_count=0 and c.candidate_count=c.confirmed_count+c.excluded_count
 and ((now() at time zone 'America/Sao_Paulo')::date<=r.end_date or (r.cutoff_date=r.end_date and (r.finished_at at time zone 'America/Sao_Paulo')::date>r.end_date)) from counts c
 on conflict(period_key) do update set candidate_count=excluded.candidate_count,confirmed_count=excluded.confirmed_count,excluded_count=excluded.excluded_count,
 pending_count=excluded.pending_count,included_period_count=excluded.included_period_count,reasons=excluded.reasons,source_hash=excluded.source_hash,complete=excluded.complete,assessed_at=now()
 returning *
 ) select to_jsonb(saved) into result from saved;
 insert into public.clickdesk_final_coverage(source_key,start_date,end_date,candidate_count,confirmed_count,pending_count,completeness,evidence_hash,verified_at)
 values('period_inventory_'||p_period,r.start_date,r.cutoff_date,(result->>'candidate_count')::int,(result->>'confirmed_count')::int,(result->>'pending_count')::int,
 case when (result->>'complete')::boolean then 'complete' else 'partial' end,result->>'source_hash',now())
 on conflict(source_key) do update set start_date=excluded.start_date,end_date=excluded.end_date,candidate_count=excluded.candidate_count,confirmed_count=excluded.confirmed_count,
 pending_count=excluded.pending_count,completeness=excluded.completeness,evidence_hash=excluded.evidence_hash,verified_at=excluded.verified_at;
 return result;
end $function$;
revoke all on function public."assess_clickdesk_period_inventory"(p_period text) from public,anon,authenticated;
grant execute on function public."assess_clickdesk_period_inventory"(p_period text) to service_role;

CREATE OR REPLACE FUNCTION public.claim_clickdesk_360_work(p_limit integer DEFAULT 2)
 RETURNS SETOF clickdesk_360_work_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(hashtext('clickdesk_360_claim'));
 if exists(select 1 from public.clickdesk_360_worker_health where cooldown_until>now()) then return; end if;
 update public.clickdesk_360_work_queue set status=case when attempts<3 then 'pending' else 'failed' end,
 error_code='worker_lease_expired',lease_token=null,lease_until=null,updated_at=now()
 where status='processing' and lease_until<now();
 return query with picked as (
 select w.ticket_id from public.clickdesk_360_work_queue w
 where w.status='pending' and w.next_attempt_at<=now() and w.attempts<3
 and exists(select 1 from public.chat_analysts a where a.id=w.analyst_id and a.active)
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=w.ticket_id)
 order by w.attempts,w.occurred_date,w.satisfaction_label,w.ticket_id
 for update skip locked
 limit least(greatest(p_limit,1),greatest(0,2-(select count(*)::integer from public.clickdesk_360_work_queue where status='processing')))
 ) update public.clickdesk_360_work_queue w set status='processing',attempts=w.attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '150 seconds',updated_at=now()
 from picked p where w.ticket_id=p.ticket_id returning w.*;
end $function$;
revoke all on function public."claim_clickdesk_360_work"(p_limit integer) from public,anon,authenticated;
grant execute on function public."claim_clickdesk_360_work"(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_clickdesk_capture_unit()
 RETURNS TABLE(job_id uuid, task_key text, path text, lease_token uuid, attempt integer)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare selected_job uuid; selected_key text; claim_token uuid := gen_random_uuid();
begin
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture_claim_capacity',0));
 if (select count(*) from public.clickdesk_official_capture_tasks t where t.status='running' and t.lease_until>clock_timestamp())>=4 then return;end if;
 select j.id into selected_job from public.clickdesk_official_capture_jobs j
 where j.status in ('pending','running') and exists(
 select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and
 (t.status='failed' or (t.status='pending' and t.next_attempt_at<=clock_timestamp())
 or (t.status='running' and t.lease_until<=clock_timestamp())))
 order by j.created_at,j.id for update of j skip locked limit 1;
 if not found then return;end if;
 if exists(select 1 from public.clickdesk_official_capture_jobs j where j.id=selected_job and j.started_at<clock_timestamp()-interval '30 minutes') then
 update public.clickdesk_official_capture_jobs j set status='failed' where j.id=selected_job;return;end if;
 update public.clickdesk_official_capture_tasks t
 set status='failed',lease_token=null,lease_until=null,error_code='capture_retry_exhausted'
 where t.job_id=selected_job and t.status='running' and t.lease_until<=clock_timestamp() and t.attempts>=5;
 if exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=selected_job and t.status='failed') then
 update public.clickdesk_official_capture_jobs j set status='failed' where j.id=selected_job;
 return;end if;
 select t.task_key into selected_key from public.clickdesk_official_capture_tasks t
 where t.job_id=selected_job and t.attempts<5 and
 ((t.status='pending' and t.next_attempt_at<=clock_timestamp()) or
 (t.status='running' and t.lease_until<=clock_timestamp()))
 order by t.task_key for update of t skip locked limit 1;
 if not found then return;end if;
 update public.clickdesk_official_capture_jobs j set status='running',started_at=coalesce(j.started_at,clock_timestamp()) where j.id=selected_job;
 return query update public.clickdesk_official_capture_tasks t
 set status='running',attempts=t.attempts+1,lease_token=claim_token,
 lease_until=clock_timestamp()+interval '90 seconds',error_code=null
 where t.job_id=selected_job and t.task_key=selected_key
 returning t.job_id,t.task_key,t.path,t.lease_token,t.attempts;
end $function$;
revoke all on function public."claim_clickdesk_capture_unit"() from public,anon,authenticated;
grant execute on function public."claim_clickdesk_capture_unit"() to service_role;

CREATE OR REPLACE FUNCTION public.claim_clickdesk_event_capture(p_period text, p_limit integer DEFAULT 64)
 RETURNS SETOF clickdesk_event_capture_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 insert into public.clickdesk_event_capture_queue(ticket_id,source_version)
 select ticket_id,source_updated_at from public.clickdesk_period_inventory_candidates where period_key=p_period
 on conflict(ticket_id) do update set source_version=excluded.source_version,
 status=case when excluded.source_version>clickdesk_event_capture_queue.source_version then 'pending' else clickdesk_event_capture_queue.status end,
 attempts=case when excluded.source_version>clickdesk_event_capture_queue.source_version then 0 else clickdesk_event_capture_queue.attempts end,
 next_attempt_at=case when excluded.source_version>clickdesk_event_capture_queue.source_version then now() else clickdesk_event_capture_queue.next_attempt_at end;
 return query with chosen as (select q.ticket_id from public.clickdesk_event_capture_queue q
 where ((q.status in ('pending','failed') and q.next_attempt_at<=now()) or (q.status='processing' and q.lease_until<now()))
 order by q.source_version desc,q.ticket_id limit least(greatest(p_limit,1),128) for update skip locked)
 update public.clickdesk_event_capture_queue q set status='processing',attempts=q.attempts+1,
 lease_until=now()+interval '3 minutes',lease_token=gen_random_uuid() from chosen c where q.ticket_id=c.ticket_id returning q.*;
end $function$;
revoke all on function public."claim_clickdesk_event_capture"(p_period text, p_limit integer) from public,anon,authenticated;
grant execute on function public."claim_clickdesk_event_capture"(p_period text, p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_clickdesk_neutral_reviews(p_limit integer DEFAULT 2)
 RETURNS SETOF clickdesk_neutral_reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 update public.clickdesk_neutral_reviews n set status='pending',attempts=0,exclusion_eligible=false,next_attempt_at=now()
 from public.clickdesk_event_capture_queue q where q.ticket_id=n.ticket_id and n.status in ('verified','needs_review') and n.conversation_version<q.source_version;
 return query with chosen as(select n.ticket_id from public.clickdesk_neutral_reviews n
 where ((n.status in ('pending','technical_failure') and n.next_attempt_at<=now()) or (n.status='processing' and n.lease_until<now()))
 order by n.attempts,n.next_attempt_at limit least(greatest(p_limit,1),4) for update skip locked)
 update public.clickdesk_neutral_reviews n set status='processing',attempts=n.attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes' from chosen c where n.ticket_id=c.ticket_id returning n.*;
end $function$;
revoke all on function public."claim_clickdesk_neutral_reviews"(p_limit integer) from public,anon,authenticated;
grant execute on function public."claim_clickdesk_neutral_reviews"(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.claim_clickdesk_reconciliation_cycle()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare token uuid:=gen_random_uuid();
begin
 update public.clickdesk_reconciliation_cycle set lease_token=token,lease_until=now()+interval '200 seconds' where singleton and (lease_until is null or lease_until<now());
 if not found then return null; end if; return token;
end $function$;
revoke all on function public."claim_clickdesk_reconciliation_cycle"() from public,anon,authenticated;
grant execute on function public."claim_clickdesk_reconciliation_cycle"() to service_role;

CREATE OR REPLACE FUNCTION public.clickdesk_save_verified_contributions(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare v_rows integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or
    jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 100
 then raise exception 'Use 1 to 20 verified contribution rows'; end if;
 with rows_in as (
  select * from jsonb_to_recordset(p_rows) as x(
    ticket_id text,analyst_id uuid,team_id uuid,analyst_name text,
    first_message_id text,first_answered_at timestamptz,occurred_date date,
    satisfaction_label text,rating_attribution text,
    rating_last_message_id text,rating_last_answered_at timestamptz,
    evidence_source text
  )
 )
 select count(*) into v_rows from rows_in;
 if v_rows is null or v_rows <= 0 then raise exception 'No valid contribution rows'; end if;
 -- Ensure incoming rows are unique before changing stored ratings.
 if exists (
   select 1 from jsonb_to_recordset(p_rows)
   as r(ticket_id text,analyst_id uuid)
   group by ticket_id,analyst_id having count(*)>1
 ) then raise exception 'Duplicate ticket+analyst in one backfill batch'; end if;
 if exists (
   select 1 from jsonb_to_recordset(p_rows) as r(
    ticket_id text,analyst_id uuid,satisfaction_label text,rating_attribution text,
    rating_last_message_id text,rating_last_answered_at timestamptz
   ) where (r.satisfaction_label is not null and
       (r.rating_attribution is distinct from 'last_public_human_answer' or
       r.rating_last_message_id is null or r.rating_last_answered_at is null))
     or (r.satisfaction_label is null and r.rating_attribution is distinct from 'unverified')
 ) then raise exception 'Incomplete rating attribution evidence'; end if;
 if exists (
   select 1 from jsonb_to_recordset(p_rows)
     as r(ticket_id text,satisfaction_label text)
    where satisfaction_label in ('positive','negative')
    group by ticket_id having count(*)>1
 ) then raise exception 'Only one rating owner per ticket allowed'; end if;
 -- All following changes form one Postgres transaction.
 -- Clear prior owner first: re-opened tickets may have a new last human.
 update public.clickdesk_chat_verified_contributions t
 set satisfaction_label=null,rating_attribution='unverified',
 rating_last_message_id=null,rating_last_answered_at=null
 where t.ticket_id in (
   select distinct x.ticket_id from jsonb_to_recordset(p_rows) as x(ticket_id text)
 ) and t.satisfaction_label is not null;
 insert into public.clickdesk_chat_verified_contributions (
   ticket_id,analyst_id,team_id,analyst_name,first_message_id,first_answered_at,
   occurred_date,satisfaction_label,rating_attribution,rating_last_message_id,
   rating_last_answered_at,evidence_source
 )
 select x.ticket_id,x.analyst_id,x.team_id,x.analyst_name,x.first_message_id,
   x.first_answered_at,x.occurred_date,x.satisfaction_label,x.rating_attribution,
   x.rating_last_message_id,x.rating_last_answered_at,x.evidence_source
 from jsonb_to_recordset(p_rows) as x(
    ticket_id text,analyst_id uuid,team_id uuid,analyst_name text,
    first_message_id text,first_answered_at timestamptz,occurred_date date,
    satisfaction_label text,rating_attribution text,
    rating_last_message_id text,rating_last_answered_at timestamptz,
    evidence_source text)
 on conflict (ticket_id,analyst_id) do update set
   team_id=excluded.team_id,analyst_name=excluded.analyst_name,
   first_message_id=excluded.first_message_id,first_answered_at=excluded.first_answered_at,
   occurred_date=excluded.occurred_date,satisfaction_label=excluded.satisfaction_label,
   rating_attribution=excluded.rating_attribution,
   rating_last_message_id=excluded.rating_last_message_id,
   rating_last_answered_at=excluded.rating_last_answered_at,
   evidence_source=excluded.evidence_source,verified_at=now();
 return v_rows;
end $function$;
revoke all on function public."clickdesk_save_verified_contributions"(p_rows jsonb) from public,anon,authenticated;
grant execute on function public."clickdesk_save_verified_contributions"(p_rows jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.clickdesk_verified_capture_incomplete_count()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists (
   select 1 from public.profiles p
   where p.id=auth.uid() and p.role in ('master','coordenadora','analista')
 ) then
   raise exception 'not authorized';
 end if;
 return (select count(*)::integer from public.clickdesk_chat_capture_queue
   where status in ('pending','queued','error'));
end
$function$;
revoke all on function public."clickdesk_verified_capture_incomplete_count"() from public,anon,authenticated;
grant execute on function public."clickdesk_verified_capture_incomplete_count"() to service_role;
grant execute on function public."clickdesk_verified_capture_incomplete_count"() to authenticated;

CREATE OR REPLACE FUNCTION public.complete_clickdesk_capture_unit(p_job_id uuid, p_key text, p_token uuid, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare claimed record; pages integer; page_number integer;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'invalid_capture_payload';end if;
 perform 1 from public.clickdesk_official_capture_jobs j
 where j.id=p_job_id and j.status='running' for update;
 if not found then return false;end if;
 select t.path into claimed from public.clickdesk_official_capture_tasks t
 where t.job_id=p_job_id and t.task_key=p_key and t.status='running'
 and t.lease_token=p_token and t.lease_until>clock_timestamp() for update;
 if not found then return false;end if;
 if p_key like 'ratings:%' then
  if jsonb_typeof(p_payload->'data') is distinct from 'array'
   or coalesce(p_payload->>'last_page','') !~ '^[0-9]{1,3}$'
   or coalesce(p_payload->>'total','') !~ '^[0-9]{1,9}$'
  then raise exception 'invalid_capture_pagination';end if;
  pages:=(p_payload->>'last_page')::integer;
  if pages<1 or pages>500 or jsonb_array_length(p_payload->'data')>100
  then raise exception 'invalid_capture_pagination';end if;
  if p_key ~ '^ratings:(3|12):1$' and pages>1 then
   for page_number in 2..pages loop
    insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
    values(p_job_id,regexp_replace(p_key,':1$',':'||page_number::text),
     regexp_replace(claimed.path,'([?&]page=)1$', '\1'||page_number::text))
    on conflict(job_id,task_key) do nothing;
   end loop;
  end if;
 end if;
 update public.clickdesk_official_capture_tasks t
 set status='complete',payload=p_payload,completed_at=clock_timestamp(),lease_token=null,lease_until=null
 where t.job_id=p_job_id and t.task_key=p_key;
 return true;
end $function$;
revoke all on function public."complete_clickdesk_capture_unit"(p_job_id uuid, p_key text, p_token uuid, p_payload jsonb) from public,anon,authenticated;
grant execute on function public."complete_clickdesk_capture_unit"(p_job_id uuid, p_key text, p_token uuid, p_payload jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.configure_clickdesk_360_worker(p_api_key text, p_model text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sid uuid;
begin
 if length(p_api_key)<20 or length(p_api_key)>512 then raise exception 'Invalid provider configuration'; end if;
 select id into sid from vault.secrets where name='clickdesk_360_google_api_key';
 if sid is null then perform vault.create_secret(p_api_key,'clickdesk_360_google_api_key','Provider da IA qualitativa exclusiva da homologação');
 else perform vault.update_secret(sid,p_api_key); end if;
 select id into sid from vault.secrets where name='clickdesk_360_google_model';
 if sid is null then perform vault.create_secret(coalesce(nullif(p_model,''),'gemini-3.5-flash-lite'),'clickdesk_360_google_model','Modelo já configurado na aplicação de homologação');
 else perform vault.update_secret(sid,coalesce(nullif(p_model,''),'gemini-3.5-flash-lite')); end if;
end $function$;
revoke all on function public."configure_clickdesk_360_worker"(p_api_key text, p_model text) from public,anon,authenticated;
grant execute on function public."configure_clickdesk_360_worker"(p_api_key text, p_model text) to service_role;

CREATE OR REPLACE FUNCTION public.current_user_chat_analyst_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p.chat_analyst_id from public.profiles p join public.chat_analysts a on a.id=p.chat_analyst_id where p.id=auth.uid() and a.active
$function$;
revoke all on function public."current_user_chat_analyst_id"() from public,anon,authenticated;
grant execute on function public."current_user_chat_analyst_id"() to service_role;
grant execute on function public."current_user_chat_analyst_id"() to authenticated;

CREATE OR REPLACE FUNCTION public.current_user_chat_team_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select ca.team_id
  from public.chat_analysts ca
  where ca.id = public.current_user_chat_analyst_id()
$function$;
revoke all on function public."current_user_chat_team_id"() from public,anon,authenticated;
grant execute on function public."current_user_chat_team_id"() to service_role;
grant execute on function public."current_user_chat_team_id"() to authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_clickdesk_360_on_ledger_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.occurred_date<date_trunc('month',now() at time zone 'America/Sao_Paulo')::date or new.occurred_date>(now() at time zone 'America/Sao_Paulo')::date then return new; end if;
 if new.satisfaction_label not in('positive','negative') or new.satisfaction_label is null or not exists(select 1 from public.chat_analysts where id=new.analyst_id and active) then return new; end if;
 if exists(select 1 from public.clickdesk_qualitative_analyses a where a.clickdesk_ticket_id=new.ticket_id and a.analyst_id=new.analyst_id and a.occurred_date=new.occurred_date and a.satisfaction_label=new.satisfaction_label and
 (a.validation_status='rejected' or case when a.analysis->>'_analysis_version' ~ '^[0-9]+$' then (a.analysis->>'_analysis_version')::numeric else 1 end>=2)) then return new; end if;
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 values(new.ticket_id,new.analyst_id,new.team_id,new.occurred_date,new.satisfaction_label)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,occurred_date=excluded.occurred_date,satisfaction_label=excluded.satisfaction_label,status='pending',attempts=0,error_code=null,lease_token=null,lease_until=null,next_attempt_at=now(),updated_at=now();
 return new;
end $function$;
revoke all on function public."enqueue_clickdesk_360_on_ledger_insert"() from public,anon,authenticated;
grant execute on function public."enqueue_clickdesk_360_on_ledger_insert"() to service_role;

CREATE OR REPLACE FUNCTION public.enqueue_clickdesk_capture(p_start date, p_end date, p_owners integer[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare existing_id uuid; created_id uuid; owner_id integer; department integer; base_query text; owner_query text;
begin
 if p_start is null or p_end is null or p_start>p_end
 or date_trunc('month',p_start)<>date_trunc('month',p_end)
 or p_end>(clock_timestamp() at time zone 'America/Sao_Paulo')::date
 or coalesce(cardinality(p_owners),0)=0
 or exists(select 1 from unnest(p_owners) x where x is null or x<=0)
 or cardinality(p_owners)<>(select count(distinct x) from unnest(p_owners) x)
 then raise exception 'invalid_capture_plan';end if;
 if exists(select 1 from unnest(p_owners) x where not exists(
  select 1 from public.clickdesk_official_owner_registry r
  where r.clickdesk_owner_id=x and r.active and r.source_scope='suporte_erp_fiscal'
  and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77)))
 or cardinality(p_owners)<>(select count(*) from public.clickdesk_official_owner_registry r
 where r.active and r.source_scope='suporte_erp_fiscal'
 and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77))
 then raise exception 'capture_roster_changed';end if;
 -- Serialize only enqueue for this period. No network request is made under this lock.
 perform pg_advisory_xact_lock(hashtextextended('clickdesk_capture:'||p_start::text||':'||p_end::text,0));
 update public.clickdesk_official_capture_jobs j set status='failed' where j.period_start=p_start and j.period_end=p_end and j.status in ('pending','running') and j.started_at<clock_timestamp()-interval '30 minutes';
 select j.id into existing_id from public.clickdesk_official_capture_jobs j
 where j.period_start=p_start and j.period_end=p_end and j.status in ('pending','running','publishing');
 if found then return existing_id;end if;
 insert into public.clickdesk_official_capture_jobs(period_start,period_end,owners)
 values(p_start,p_end,p_owners) returning id into created_id;
 base_query:='from='||p_start::text||'&to='||p_end::text;
 select string_agg('&owner_ids%5B%5D='||x::text,'' order by x) into owner_query from unnest(p_owners) x;
 insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
 values(created_id,'group','/support/reports/agents?'||base_query||'&department_ids%5B%5D=3&department_ids%5B%5D=12'||owner_query);
 foreach owner_id in array p_owners loop
  insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
  values(created_id,'owner:'||owner_id::text,'/support/reports/agents?'||base_query||'&department_ids%5B%5D=3&department_ids%5B%5D=12&owner_ids%5B%5D='||owner_id::text);
 end loop;
 foreach department in array array[3,12] loop
  insert into public.clickdesk_official_capture_tasks(job_id,task_key,path)
  values(created_id,'ratings:'||department::text||':1','/support/reports/ratings?'||base_query||'&department_id='||department::text||'&per_page=100&page=1');
 end loop;
 return created_id;
end $function$;
revoke all on function public."enqueue_clickdesk_capture"(p_start date, p_end date, p_owners integer[]) from public,anon,authenticated;
grant execute on function public."enqueue_clickdesk_capture"(p_start date, p_end date, p_owners integer[]) to service_role;

CREATE OR REPLACE FUNCTION public.fail_clickdesk_capture_finalization(p_job_id uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 update public.clickdesk_official_capture_jobs j set status='failed'
 where j.id=p_job_id and j.status='running'
 and not exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status<>'complete');
$function$;
revoke all on function public."fail_clickdesk_capture_finalization"(p_job_id uuid) from public,anon,authenticated;
grant execute on function public."fail_clickdesk_capture_finalization"(p_job_id uuid) to service_role;

CREATE OR REPLACE FUNCTION public.finalize_clickdesk_capture(p_job_id uuid, p_rows jsonb, p_votes jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare job record; source_owner record; metric jsonb; owner_payload jsonb; group_payload jsonb;
 department integer; first_page jsonb; expected_pages integer; expected_total integer; actual_pages integer; actual_total bigint;
begin
 select * into job from public.clickdesk_official_capture_jobs j where j.id=p_job_id for update;
 if not found then raise exception 'capture_job_missing';end if;
 if job.status='published' then return true;end if;
 if job.status<>'running' then return false;end if;
 if job.started_at is null or job.started_at<clock_timestamp()-interval '30 minutes' then
  update public.clickdesk_official_capture_jobs j set status='failed' where j.id=p_job_id;return false;end if;
 if exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.status<>'complete')
 then return false;end if;
 if (select count(*) from public.clickdesk_official_owner_registry r where r.active
 and r.source_scope='suporte_erp_fiscal' and r.clickdesk_owner_id not in (1,12,21,26,57,59,61,77))<>cardinality(job.owners)
 or exists(select 1 from unnest(job.owners) x where not exists(
 select 1 from public.clickdesk_official_owner_registry r where r.active and r.source_scope='suporte_erp_fiscal'
 and r.clickdesk_owner_id=x and x not in (1,12,21,26,57,59,61,77)))
 then raise exception 'capture_roster_changed';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_votes) is distinct from 'array'
 or jsonb_array_length(p_rows)<>cardinality(job.owners) then raise exception 'invalid_capture_output';end if;
 select t.payload into group_payload from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='group';
 if group_payload is null then raise exception 'capture_group_missing';end if;
 foreach department in array array[3,12] loop
  select t.payload into first_page from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='ratings:'||department::text||':1';
  if first_page is null then raise exception 'capture_page_missing';end if;
  expected_pages:=(first_page->>'last_page')::integer;expected_total:=(first_page->>'total')::integer;
  select count(*),coalesce(sum(jsonb_array_length(t.payload->'data')),0) into actual_pages,actual_total
  from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key like 'ratings:'||department::text||':%';
  if actual_pages<>expected_pages or actual_total<>expected_total
  or exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id
   and t.task_key like 'ratings:'||department::text||':%' and
   ((t.payload->>'last_page')::integer<>expected_pages or (t.payload->>'total')::integer<>expected_total))
  then raise exception 'capture_ratings_incomplete';end if;
 end loop;
 for source_owner in select r.* from public.clickdesk_official_owner_registry r where r.clickdesk_owner_id=any(job.owners) loop
  if (select count(*) from jsonb_array_elements(p_rows) x where x->>'source_owner_key'=source_owner.source_owner_key)<>1
  then raise exception 'capture_owner_output_missing';end if;
  select x into metric from jsonb_array_elements(p_rows) x where x->>'source_owner_key'=source_owner.source_owner_key;
  select t.payload into owner_payload from public.clickdesk_official_capture_tasks t where t.job_id=p_job_id and t.task_key='owner:'||source_owner.clickdesk_owner_id::text;
  if owner_payload is null or (metric->>'attendances')::integer is distinct from (owner_payload#>>'{summary,received,value}')::integer
  or metric->>'attendance_basis' is distinct from 'received'
  or metric->>'source_scope' is distinct from 'suporte_erp_fiscal'
  or (metric->>'period_start')::date is distinct from job.period_start
  or (metric->>'period_end')::date is distinct from job.period_end
  then raise exception 'capture_output_not_reconciled';end if;
 end loop;
 if (select sum((x->>'attendances')::integer) from jsonb_array_elements(p_rows) x)
 is distinct from (group_payload#>>'{summary,received,value}')::integer then raise exception 'received_counts_not_reconciled';end if;
 update public.clickdesk_official_capture_jobs j set status='publishing' where j.id=p_job_id;
 if public.publish_clickdesk_official_capture(p_rows,p_votes) is distinct from true then raise exception 'capture_publish_failed';end if;
 update public.clickdesk_official_capture_jobs j set status='published',published_at=clock_timestamp() where j.id=p_job_id;
 return true;
end $function$;
revoke all on function public."finalize_clickdesk_capture"(p_job_id uuid, p_rows jsonb, p_votes jsonb) from public,anon,authenticated;
grant execute on function public."finalize_clickdesk_capture"(p_job_id uuid, p_rows jsonb, p_votes jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.finish_clickdesk_360_work(p_ticket text, p_lease uuid, p_analysis jsonb, p_model text, p_hash text, p_characters integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare w public.clickdesk_360_work_queue; l public.clickdesk_final_ticket_ledger;
begin
 select * into w from public.clickdesk_360_work_queue where ticket_id=p_ticket for update;
 if not found or w.status<>'processing' or w.lease_token is distinct from p_lease then return false; end if;
 select * into l from public.clickdesk_final_ticket_ledger where ticket_id=p_ticket;
 if not found or l.analyst_id<>w.analyst_id or l.satisfaction_label is distinct from w.satisfaction_label
 or l.occurred_date<>w.occurred_date or exists(select 1 from public.clickdesk_final_ticket_pending where ticket_id=p_ticket)
 or not exists(select 1 from public.chat_analysts where id=l.analyst_id and active) then
 update public.clickdesk_360_work_queue set status='failed',error_code='authorship_changed',lease_token=null,lease_until=null,updated_at=now() where ticket_id=p_ticket;
 return false; end if;
 if p_characters<1 or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_analysis)<>'object' then raise exception 'Invalid result'; end if;
 insert into public.clickdesk_qualitative_analyses(clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,transcript_hash,transcript_characters,created_by,validation_status,updated_at)
 values(p_ticket,l.analyst_id,l.occurred_date,l.area,l.satisfaction_label,p_analysis,p_model,p_hash,p_characters,null,'pending',now())
 on conflict(clickdesk_ticket_id) do update set
 analyst_id=excluded.analyst_id,occurred_date=excluded.occurred_date,area=excluded.area,satisfaction_label=excluded.satisfaction_label,
 analysis=excluded.analysis,model=excluded.model,transcript_hash=excluded.transcript_hash,transcript_characters=excluded.transcript_characters,updated_at=now(),
 validation_status=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id
 and clickdesk_qualitative_analyses.occurred_date=excluded.occurred_date
 and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validation_status else 'pending' end,
 validated_by=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validated_by else null end,
 validated_at=case when clickdesk_qualitative_analyses.analyst_id=excluded.analyst_id and clickdesk_qualitative_analyses.satisfaction_label=excluded.satisfaction_label then clickdesk_qualitative_analyses.validated_at else null end;
 update public.clickdesk_360_work_queue set status='done',completed_at=now(),error_code=null,lease_token=null,lease_until=null,updated_at=now() where ticket_id=p_ticket;
 return true;
end $function$;
revoke all on function public."finish_clickdesk_360_work"(p_ticket text, p_lease uuid, p_analysis jsonb, p_model text, p_hash text, p_characters integer) from public,anon,authenticated;
grant execute on function public."finish_clickdesk_360_work"(p_ticket text, p_lease uuid, p_analysis jsonb, p_model text, p_hash text, p_characters integer) to service_role;

CREATE OR REPLACE FUNCTION public.finish_clickdesk_event_capture(p_ticket text, p_lease uuid, p_events jsonb, p_receipts jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.clickdesk_event_capture_queue; r record; old_row public.clickdesk_event_receipts;
begin
 select * into q from public.clickdesk_event_capture_queue where ticket_id=p_ticket for update;
 if not found or q.lease_token is distinct from p_lease or q.status<>'processing' then return false; end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_typeof(p_receipts)<>'array' then raise exception 'Invalid event payload'; end if;
 for r in select * from jsonb_to_recordset(p_receipts) as x(ticket_id text,event_id text,analyst_id uuid,team_id uuid,received_at timestamptz,occurred_date date,department text) loop
  if r.ticket_id<>p_ticket or not exists(select 1 from jsonb_array_elements(p_events) e where e->>'id'=r.event_id) then raise exception 'Unproven receipt'; end if;
  select * into old_row from public.clickdesk_event_receipts where ticket_id=p_ticket and analyst_id=r.analyst_id;
  if found and (old_row.received_at is distinct from r.received_at or old_row.event_id is distinct from r.event_id) then
   insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
   values(p_ticket,'receipt_event_changed',to_jsonb(old_row),to_jsonb(r),md5(to_jsonb(r)::text)) on conflict do nothing;
  else
   insert into public.clickdesk_event_receipts(ticket_id,analyst_id,team_id,event_id,received_at,occurred_date,department)
   values(p_ticket,r.analyst_id,r.team_id,r.event_id,r.received_at,r.occurred_date,r.department) on conflict do nothing;
  end if;
 end loop;
 insert into public.clickdesk_event_ticket_history(ticket_id,source_version,events) values(p_ticket,q.source_version,p_events)
 on conflict(ticket_id) do update set source_version=excluded.source_version,events=excluded.events,captured_at=now();
 update public.clickdesk_event_capture_queue set status='complete',captured_at=now(),lease_token=null,lease_until=null,error_code=null where ticket_id=p_ticket;
 return true;
end $function$;
revoke all on function public."finish_clickdesk_event_capture"(p_ticket text, p_lease uuid, p_events jsonb, p_receipts jsonb) from public,anon,authenticated;
grant execute on function public."finish_clickdesk_event_capture"(p_ticket text, p_lease uuid, p_events jsonb, p_receipts jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.finish_clickdesk_neutral_review(p_ticket text, p_lease uuid, p_hash text, p_conversation_version timestamp with time zone, p_analysis jsonb, p_model text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.clickdesk_neutral_reviews;r public.clickdesk_event_ratings; eligible boolean;
begin
 select * into n from public.clickdesk_neutral_reviews where ticket_id=p_ticket for update;
 if not found or n.lease_token is distinct from p_lease or n.status<>'processing' then return false; end if;
 select * into r from public.clickdesk_event_ratings where ticket_id=p_ticket;
 if r.source_hash is distinct from n.source_hash then return false; end if;
 eligible:=coalesce((p_analysis->>'exclusion_eligible')::boolean,false)
  and p_analysis->>'cause' in ('system','other_external') and p_analysis->>'confidence'='high'
  and p_analysis->>'human_contribution'='false' and p_analysis->>'two_pass_agreement'='true'
  and r.original_label='Neutro' and r.sentiment='negative' and length(p_hash)=64;
 insert into public.clickdesk_neutral_review_attempts(ticket_id,source_hash,transcript_hash,analysis,model)
 values(p_ticket,n.source_hash,p_hash,p_analysis,p_model);
 update public.clickdesk_neutral_reviews set cause=case when p_analysis->>'cause' in ('human','system','other_external','mixed','inconclusive') then p_analysis->>'cause' else 'inconclusive' end,
 status=case when p_analysis->>'cause'='inconclusive' then 'needs_review' else 'verified' end,
 transcript_hash=p_hash,analysis=p_analysis,model=p_model,exclusion_eligible=eligible,
 conversation_version=p_conversation_version,lease_token=null,lease_until=null,error_code=null,reviewed_at=now()
 where ticket_id=p_ticket;
 return true;
end $function$;
revoke all on function public."finish_clickdesk_neutral_review"(p_ticket text, p_lease uuid, p_hash text, p_conversation_version timestamp with time zone, p_analysis jsonb, p_model text) from public,anon,authenticated;
grant execute on function public."finish_clickdesk_neutral_review"(p_ticket text, p_lease uuid, p_hash text, p_conversation_version timestamp with time zone, p_analysis jsonb, p_model text) to service_role;

CREATE OR REPLACE FUNCTION public.get_clickdesk_360_queue_status(p_start date, p_end date, p_team uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.is_management_user() then raise exception 'Management only' using errcode='42501'; end if;
 if p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 return jsonb_build_object(
 'scope',jsonb_build_object('start',p_start,'end',p_end,'team_id',p_team),
 'counts',(select jsonb_build_object('pending',count(*) filter(where w.status='pending'),'processing',count(*) filter(where w.status='processing'),'failed',count(*) filter(where w.status='failed'),'done',count(*) filter(where w.status='done'))
 from public.clickdesk_360_work_queue w join public.chat_analysts a on a.id=w.analyst_id and a.active
 where w.occurred_date between p_start and p_end and (p_team is null or w.team_id=p_team)),
 'health',(select to_jsonb(h) from public.clickdesk_360_worker_health h where singleton),
 'failures',(select coalesce(jsonb_agg(f),'[]'::jsonb) from(
 select ticket_id,error_code,attempts,next_attempt_at from public.clickdesk_360_work_queue
 where status='failed' and occurred_date between p_start and p_end and (p_team is null or team_id=p_team)
 order by updated_at desc limit 20)f),
 'inventory',(select jsonb_build_object(
 'scope','all_teams_in_month','run',to_jsonb(r),
 'assessment',(select to_jsonb(a) from public.clickdesk_inventory_assessment a where a.period_key=r.period_key),
 'source_exceptions',(select coalesce(jsonb_agg(e),'[]'::jsonb) from (select p.ticket_id,p.reason,p.checked_at from public.clickdesk_period_inventory_candidates c join public.clickdesk_final_ticket_pending p using(ticket_id) where c.period_key=r.period_key and (p.reason like 'history_incomplete%' or p.reason like 'clickdesk_http_%' or p.reason='history_read_failed') order by p.ticket_id limit 30)e),
 'source_exclusions',(select coalesce(jsonb_agg(e),'[]'::jsonb) from(select distinct d.ticket_id,d.reason,d.source_deleted_at,d.verified_at from public.clickdesk_source_exclusions d join public.clickdesk_chat_attendances c on c.clickdesk_ticket_id=d.ticket_id where c.occurred_date between p_start and p_end and (p_team is null or c.team_id=p_team) order by d.ticket_id limit 30)e),
 'partitions',(select jsonb_object_agg(status,n) from(select status,count(*) n from public.clickdesk_inventory_partitions where period_key=r.period_key group by status)p))
 from public.clickdesk_period_inventory r where r.period_key=to_char(p_start,'YYYY-MM')),
 'refreshed_at',now());
end $function$;
revoke all on function public."get_clickdesk_360_queue_status"(p_start date, p_end date, p_team uuid) from public,anon,authenticated;
grant execute on function public."get_clickdesk_360_queue_status"(p_start date, p_end date, p_team uuid) to service_role;
grant execute on function public."get_clickdesk_360_queue_status"(p_start date, p_end date, p_team uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_360_worker_config()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'api_key',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_api_key'),
 'account_id',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_account_id'),
 'google_api_key',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_360_google_api_key'),
 'model',(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_360_google_model'));
$function$;
revoke all on function public."get_clickdesk_360_worker_config"() from public,anon,authenticated;
grant execute on function public."get_clickdesk_360_worker_config"() to service_role;

CREATE OR REPLACE FUNCTION public.get_clickdesk_cron_credentials(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_expected text;
  v_api_key text;
  v_account_id text;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets
  where name = 'clickdesk_cron_token'
  limit 1;

  if v_expected is null
     or p_token is null
     or extensions.digest(p_token, 'sha256') <> extensions.digest(v_expected, 'sha256') then
    raise exception 'Token inválido.' using errcode = '42501';
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'clickdesk_api_key'
  limit 1;

  select decrypted_secret into v_account_id
  from vault.decrypted_secrets
  where name = 'clickdesk_account_id'
  limit 1;

  if v_api_key is null or v_account_id is null then
    raise exception 'Credenciais ClickDesk ainda não inicializadas.' using errcode = '55000';
  end if;

  return jsonb_build_object('api_key', v_api_key, 'account_id', v_account_id);
end;
$function$;
revoke all on function public."get_clickdesk_cron_credentials"(p_token text) from public,anon,authenticated;
grant execute on function public."get_clickdesk_cron_credentials"(p_token text) to service_role;

CREATE OR REPLACE FUNCTION public.get_clickdesk_event_correction_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.is_management_user() then raise exception 'management_required' using errcode='42501'; end if;
 return (select jsonb_build_object('historical_changes',count(*) filter(where kind<>'source_deleted'),'source_deletions',count(*) filter(where kind='source_deleted')) from public.clickdesk_event_corrections where detected_at>=now()-interval '14 days');
end $function$;
revoke all on function public."get_clickdesk_event_correction_summary"() from public,anon,authenticated;
grant execute on function public."get_clickdesk_event_correction_summary"() to service_role;
grant execute on function public."get_clickdesk_event_correction_summary"() to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_metric_rows(p_start date, p_end date, p_analyst uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 if exists(select 1 from public.clickdesk_final_ticket_ledger l where l.occurred_date between p_start and p_end
 and (p_analyst is null or l.analyst_id=p_analyst) and (p_team is null or l.team_id=p_team)
 and not exists(select 1 from public.chat_analysts a where a.id=l.analyst_id)) then raise exception 'Missing roster'; end if;
 return (
 with eligible as materialized (
 select l.*,a.name,a.active from public.clickdesk_final_ticket_ledger l join public.chat_analysts a on a.id=l.analyst_id
 where l.occurred_date between p_start and p_end and (p_analyst is null or l.analyst_id=p_analyst)
 and (p_team is null or l.team_id=p_team)
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=l.ticket_id)
 ), grouped as (
 select occurred_date,team_id,analyst_id,coalesce(area,'Fila histórica não comprovada') area,name assignee_name,
 'analyst'::text identity_role,count(*) attendances,
 count(*) filter(where satisfaction_label='positive') positive_reviews,
 count(*) filter(where satisfaction_label='negative') negative_reviews,
 count(*) filter(where satisfaction_label is not null) reviews,
 null::numeric csat,null::numeric review_percentage,min(ticket_id) first_ticket
 from eligible where p_analyst is not null or active
 group by occurred_date,team_id,analyst_id,area,name
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)-'first_ticket' order by first_ticket) from grouped g),'[]'::jsonb),
 'last_reconciled_at',(select max(verified_at) from eligible),
 'excludedInactive',(select case when p_analyst is null then count(*) filter(where not active) else 0 end from eligible))
 );
end $function$;
revoke all on function public."get_clickdesk_metric_rows"(p_start date, p_end date, p_analyst uuid, p_team uuid) from public,anon,authenticated;
grant execute on function public."get_clickdesk_metric_rows"(p_start date, p_end date, p_analyst uuid, p_team uuid) to service_role;
grant execute on function public."get_clickdesk_metric_rows"(p_start date, p_end date, p_analyst uuid, p_team uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_period_attestation(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry record;
begin
 if auth.uid() is null or not(public.is_management_user() or public.current_user_chat_analyst_id() is not null) then raise exception 'Active chat access required' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period';end if;
 select c.completeness,c.pending_count,c.verified_at into entry
 from public.clickdesk_final_coverage c where c.source_key like 'period_inventory_%'
 and c.start_date<=p_start and c.end_date>=p_end
 order by c.verified_at desc limit 1;
 return jsonb_build_object('complete',coalesce(entry.completeness='complete' and entry.pending_count=0,false),'verified_at',entry.verified_at);
end $function$;
revoke all on function public."get_clickdesk_period_attestation"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_clickdesk_period_attestation"(p_start date, p_end date) to service_role;
grant execute on function public."get_clickdesk_period_attestation"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_reconciliation_batch(p_limit integer DEFAULT 24, p_refresh boolean DEFAULT false, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with raw as (
 select ticket_id,source_updated_at as version,period_end as source_day,'capture'::text origin,false as in_scope from clickdesk_chat_capture_queue
 union all select clickdesk_ticket_id,updated_at,occurred_date,'legacy',occurred_date between p_start and p_end from clickdesk_chat_attendances
 union all select ticket_id,verified_at,occurred_date,'verified',occurred_date between p_start and p_end from clickdesk_chat_verified_contributions
), candidates as materialized (
 select distinct on(ticket_id) ticket_id,version,source_day,origin,bool_or(in_scope) over(partition by ticket_id) as in_scope
 from raw where ticket_id ~ '^[0-9]{1,25}$' order by ticket_id,version desc nulls last,(origin='verified') desc,source_day desc nulls last
), eligible as materialized (
 select c.* from candidates c left join clickdesk_final_ticket_ledger l using(ticket_id)
 left join clickdesk_final_ticket_pending p using(ticket_id)
 where (p_start is null or c.in_scope) and (
 p_refresh or (l.ticket_id is not null and c.version>l.verified_at and (p.ticket_id is null or c.version>p.checked_at))
 or (l.ticket_id is null and (p.ticket_id is null or c.version>p.checked_at
 or (p.reason='final_author_not_in_eligible_registry' and p.checked_at<(select changed_at from clickdesk_registry_revision where singleton))
 or (p.reason ~ '^(clickdesk_http_|history_read_failed|history_incomplete|deadline)' and p.checked_at<now()-interval '30 minutes'))))
), batch as (
 select ticket_id as id,coalesce(version::text,'') as version,coalesce(source_day::text,'') as "sourceDay",origin
 from eligible order by source_day desc nulls last,version desc nulls last,ticket_id::numeric desc limit least(greatest(p_limit,1),128)
)
select jsonb_build_object('candidate_count',(select count(*) from candidates),'backlog_before',(select count(*) from eligible),
 'discovered_in_target_period',case when p_start is null then null else (select count(*) from candidates where in_scope) end,
 'candidates',coalesce((select jsonb_agg(to_jsonb(batch)) from batch),'[]'::jsonb));
$function$;
revoke all on function public."get_clickdesk_reconciliation_batch"(p_limit integer, p_refresh boolean, p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_clickdesk_reconciliation_batch"(p_limit integer, p_refresh boolean, p_start date, p_end date) to service_role;

CREATE OR REPLACE FUNCTION public.get_clickdesk_reconciliation_exceptions(p_limit integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with failures as materialized (
 select p.ticket_id as id,coalesce(c.source_updated_at::text,'') version,coalesce(c.period_end::text,'') as "sourceDay",'capture'::text origin
 from clickdesk_final_ticket_pending p left join clickdesk_chat_capture_queue c using(ticket_id)
 where p.reason in('history_incomplete','history_read_failed','clickdesk_http_404','final_author_ambiguous')
), batch as (select * from failures order by id::numeric desc limit least(greatest(p_limit,1),32))
select jsonb_build_object('candidate_count',(select count(*) from clickdesk_chat_capture_queue),'backlog_before',(select count(*)from failures),'discovered_in_target_period',null,'candidates',coalesce((select jsonb_agg(to_jsonb(batch))from batch),'[]'::jsonb))
$function$;
revoke all on function public."get_clickdesk_reconciliation_exceptions"(p_limit integer) from public,anon,authenticated;
grant execute on function public."get_clickdesk_reconciliation_exceptions"(p_limit integer) to service_role;

CREATE OR REPLACE FUNCTION public.get_clickdesk_self_closed_history()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with own as (
    select public.current_user_chat_analyst_id() as analyst_id
  ),
  candidates as (
    select
      c.month,
      c.id as closure_id,
      c.created_at as closed_at,
      c.team,
      a.item as analyst
    from public.integration_closures c
    cross join own
    cross join lateral jsonb_array_elements(coalesce(c.payload->'analistas', '[]'::jsonb)) a(item)
    where own.analyst_id is not null
      and c.channel = 'chat'
      and c.payload->>'fonte' = 'clickdesk_persisted'
      and c.payload->>'regras' = 'clickdesk-human-v1'
      and a.item->>'analyst_id' = own.analyst_id::text
  ),
  preferred as (
    select distinct on (month)
      month,
      closure_id,
      closed_at,
      analyst
    from candidates
    order by month, (team = 'all') desc, closed_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month', month,
        'closure_id', closure_id,
        'closed_at', closed_at,
        'analyst', analyst
      )
      order by month
    ),
    '[]'::jsonb
  )
  from preferred
$function$;
revoke all on function public."get_clickdesk_self_closed_history"() from public,anon,authenticated;
grant execute on function public."get_clickdesk_self_closed_history"() to service_role;
grant execute on function public."get_clickdesk_self_closed_history"() to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_self_official_podium_context(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public."get_clickdesk_self_official_podium_context"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_clickdesk_self_official_podium_context"(p_start date, p_end date) to service_role;
grant execute on function public."get_clickdesk_self_official_podium_context"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_self_podium_context(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
revoke all on function public."get_clickdesk_self_podium_context"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_clickdesk_self_podium_context"(p_start date, p_end date) to service_role;
grant execute on function public."get_clickdesk_self_podium_context"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_clickdesk_sync_clock(p_start date, p_end date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and (
 lower(p.role::text) in('master','coordenadora','coordinator') or (lower(p.role::text) in('analista','analyst') and p.chat_analyst_id is not null)))
 then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Período inválido.' using errcode='22023'; end if;
 return greatest((select max(finished_at) from public.clickdesk_chat_sync_runs where status='completed' and period_start<=p_end and period_end>=p_start),
 case when p_start<=current_date and p_end>='2026-09-01' then (select last_finished_at from public.clickdesk_reconciliation_health where singleton) else null end);
end $function$;
revoke all on function public."get_clickdesk_sync_clock"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_clickdesk_sync_clock"(p_start date, p_end date) to service_role;
grant execute on function public."get_clickdesk_sync_clock"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_scoped_clickdesk_event_status(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n integer; done integer; h public.clickdesk_event_sync_health; inventory_ready boolean;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and lower(p.role::text) in ('master','coordenadora','coordinator','analista','analyst')) then raise exception 'Unauthorized'; end if;
 select count(*),count(*) filter(where q.status='complete' and q.source_version>=c.source_updated_at) into n,done
 from public.clickdesk_period_inventory_candidates c left join public.clickdesk_event_capture_queue q using(ticket_id)
 where c.period_key=to_char(p_start,'YYYY-MM');
 select status='complete' and cutoff_date>=p_end into inventory_ready from public.clickdesk_period_inventory where period_key=to_char(p_start,'YYYY-MM');
 select * into h from public.clickdesk_event_sync_health where singleton;
 return jsonb_build_object('complete',coalesce(inventory_ready,false) and n>0 and done=n and h.ratings_complete and h.ratings_start<=p_start and h.ratings_end>=p_end,
 'captured_at',h.finished_at,'status',coalesce(h.status,'pending'),
 'pending',case when public.is_management_user() then n-done else null end);
end $function$;
revoke all on function public."get_scoped_clickdesk_event_status"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_scoped_clickdesk_event_status"(p_start date, p_end date) to service_role;
grant execute on function public."get_scoped_clickdesk_event_status"(p_start date, p_end date) to authenticated;

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
end $function$;
revoke all on function public."get_scoped_clickdesk_official_daily_metrics"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_scoped_clickdesk_official_daily_metrics"(p_start date, p_end date) to service_role;
grant execute on function public."get_scoped_clickdesk_official_daily_metrics"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.get_scoped_clickdesk_official_neutral_counts(p_start date, p_end date)
 RETURNS TABLE(period_start date, period_end date, source_owner_key text, excluded_neutrals bigint, neutral_human bigint, neutral_external bigint, neutral_pending bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select v.period_start,v.period_end,v.source_owner_key,
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.exclusion_eligible),
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.cause in ('human','mixed')),
 count(*) filter(where n.source_hash=v.source_hash and n.status='verified' and n.cause in ('system','other_external')),
 count(*) filter(where n.ticket_id is null or n.source_hash<>v.source_hash or n.status<>'verified')
 from public.clickdesk_official_period_votes v left join public.clickdesk_neutral_reviews n using(ticket_id)
 where v.original_label='Neutro' and v.sentiment='negative' and ((v.period_start=p_start and v.period_end=p_end) or (v.period_start=v.period_end and v.period_start between p_start and p_end))
 group by v.period_start,v.period_end,v.source_owner_key;
$function$;
revoke all on function public."get_scoped_clickdesk_official_neutral_counts"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_scoped_clickdesk_official_neutral_counts"(p_start date, p_end date) to service_role;
grant execute on function public."get_scoped_clickdesk_official_neutral_counts"(p_start date, p_end date) to authenticated;

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
revoke all on function public."get_scoped_clickdesk_official_period_metrics"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."get_scoped_clickdesk_official_period_metrics"(p_start date, p_end date) to service_role;
grant execute on function public."get_scoped_clickdesk_official_period_metrics"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.invalidate_clickdesk_360_on_source_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if row(new.analyst_id,new.team_id,new.occurred_date,new.last_public_message_id,new.last_public_at,new.satisfaction_label)
 is distinct from row(old.analyst_id,old.team_id,old.occurred_date,old.last_public_message_id,old.last_public_at,old.satisfaction_label) then
 update public.clickdesk_qualitative_analyses set
 analysis=jsonb_set(analysis,'{_analysis_version}','0'::jsonb,true),
 updated_at=now()
 where clickdesk_ticket_id=new.ticket_id and validation_status<>'rejected';
 if new.satisfaction_label in ('positive','negative') and exists(select 1 from public.chat_analysts where id=new.analyst_id and active) then
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 values(new.ticket_id,new.analyst_id,new.team_id,new.occurred_date,new.satisfaction_label)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,occurred_date=excluded.occurred_date,
 satisfaction_label=excluded.satisfaction_label,status='pending',attempts=0,error_code=null,lease_token=null,lease_until=null,next_attempt_at=now(),updated_at=now();
 end if;
 end if;
 return new;
end $function$;
revoke all on function public."invalidate_clickdesk_360_on_source_change"() from public,anon,authenticated;
grant execute on function public."invalidate_clickdesk_360_on_source_change"() to service_role;

CREATE OR REPLACE FUNCTION public.load_clickdesk_ready_capture()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('id',j.id,'start',j.period_start,'end',j.period_end,'owners',to_jsonb(j.owners),
 'parts',(select jsonb_object_agg(t.task_key,t.payload) from public.clickdesk_official_capture_tasks t where t.job_id=j.id))
 from public.clickdesk_official_capture_jobs j where j.status='running'
 and exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.task_key='group')
 and not exists(select 1 from public.clickdesk_official_capture_tasks t where t.job_id=j.id and t.status<>'complete')
 order by j.created_at,j.id limit 1;
$function$;
revoke all on function public."load_clickdesk_ready_capture"() from public,anon,authenticated;
grant execute on function public."load_clickdesk_ready_capture"() to service_role;

CREATE OR REPLACE FUNCTION public.note_clickdesk_registry_revision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin update public.clickdesk_registry_revision set changed_at=now() where singleton; return new; end $function$;
revoke all on function public."note_clickdesk_registry_revision"() from public,anon,authenticated;
grant execute on function public."note_clickdesk_registry_revision"() to service_role;

CREATE OR REPLACE FUNCTION public.publish_clickdesk_event_days(p_start date, p_end date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h public.clickdesk_event_sync_health; snapshot_at timestamptz:=now();
begin
 select * into h from public.clickdesk_event_sync_health where singleton for update;
 if not found or not h.ratings_complete or h.ratings_start>p_start or h.ratings_end<p_end then return false; end if;
 if not exists(select 1 from public.clickdesk_period_inventory where period_key=to_char(p_start,'YYYY-MM') and status='complete' and cutoff_date>=p_end) then return false; end if;
 if exists(select 1 from public.clickdesk_period_inventory_candidates c left join public.clickdesk_event_capture_queue q using(ticket_id)
 where c.period_key=to_char(p_start,'YYYY-MM') and (q.ticket_id is null or q.status<>'complete' or q.source_version<c.source_updated_at)) then return false; end if;
 insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
 select 'day:'||p.occurred_date||':'||p.analyst_id,'closed_day_event_changed',
 jsonb_build_object('attendances',p.attendances),jsonb_build_object('attendances',x.n),md5(x.n::text)
 from public.clickdesk_event_published_daily p cross join lateral
 (select count(*) n from public.clickdesk_event_receipts r where r.analyst_id=p.analyst_id and r.occurred_date=p.occurred_date) x
 where p.occurred_date between p_start and p_end and p.occurred_date<(now() at time zone 'America/Sao_Paulo')::date
 and p.attendances<>x.n on conflict do nothing;
 with people as (
  select a.id,a.team_id from public.chat_analysts a join public.clickdesk_official_owner_registry r
  on r.source_owner_key=lower(regexp_replace(translate(trim(a.name),'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),'[^a-zA-Z0-9]+',' ','g'))
  where a.active and r.active and r.source_scope='suporte_erp_fiscal'
 ), days as(select d::date occurred_date from generate_series(p_start,p_end,'1 day') d), counts as (
  select d.occurred_date,p.id analyst_id,p.team_id,
  (select count(*) from public.clickdesk_event_receipts x where x.analyst_id=p.id and x.occurred_date=d.occurred_date)::integer attendances,
  (select count(*) from public.clickdesk_event_ratings x where x.analyst_id=p.id and x.occurred_date=d.occurred_date and x.sentiment='positive')::integer positive_reviews,
  (select count(*) from public.clickdesk_event_ratings x where x.analyst_id=p.id and x.occurred_date=d.occurred_date and x.sentiment='negative')::integer negative_reviews,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and n.status='verified' and n.exclusion_eligible)::integer excluded_neutrals,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and x.original_label='Neutro' and n.status='verified' and n.cause in ('human','mixed'))::integer neutral_human,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.source_hash=x.source_hash and x.original_label='Neutro' and n.status='verified' and n.cause in ('system','other_external'))::integer neutral_external,
  (select count(*) from public.clickdesk_event_ratings x join public.clickdesk_neutral_reviews n using(ticket_id) where x.analyst_id=p.id and x.occurred_date=d.occurred_date and n.status<>'verified')::integer neutral_pending
  from days d cross join people p
 ) insert into public.clickdesk_event_published_daily select *,snapshot_at from counts
 on conflict(occurred_date,analyst_id) do update set
 attendances=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.attendances else clickdesk_event_published_daily.attendances end,
 positive_reviews=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.positive_reviews else clickdesk_event_published_daily.positive_reviews end,
 negative_reviews=case when excluded.occurred_date=(now() at time zone 'America/Sao_Paulo')::date then excluded.negative_reviews else clickdesk_event_published_daily.negative_reviews end,
 excluded_neutrals=excluded.excluded_neutrals,neutral_human=excluded.neutral_human,neutral_external=excluded.neutral_external,neutral_pending=excluded.neutral_pending,captured_at=excluded.captured_at
 where not exists(select 1 from public.integration_closures c where c.channel='chat'
 and c.month=to_char(excluded.occurred_date,'YYYY-MM') and (c.team='all' or c.team=excluded.team_id::text));
 update public.clickdesk_event_sync_health set finished_at=snapshot_at,status='ready',error_code=null where singleton;
 return true;
end $function$;
revoke all on function public."publish_clickdesk_event_days"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."publish_clickdesk_event_days"(p_start date, p_end date) to service_role;

CREATE OR REPLACE FUNCTION public.publish_clickdesk_official_capture(p_rows jsonb, p_votes jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare first_row jsonb; v jsonb; a record; source jsonb; hash text; start_day date;end_day date;
begin
 if jsonb_array_length(p_rows)=0 then raise exception 'empty_capture';end if;
 first_row:=p_rows->0;start_day:=(first_row->>'period_start')::date;end_day:=(first_row->>'period_end')::date;
 if start_day>end_day or end_day>(now() at time zone 'America/Sao_Paulo')::date or end_day-start_day>31 then raise exception 'invalid_period';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'period_start')::date<>start_day or (x->>'period_end')::date<>end_day) then raise exception 'mixed_periods';end if;
 for v in select value from jsonb_array_elements(p_rows) loop
  if (v->>'positive_reviews')::integer<>(select count(*) from jsonb_array_elements(p_votes) x where x->>'source_owner_key'=v->>'source_owner_key' and x->>'sentiment'='positive') or
  (v->>'negative_reviews')::integer<>(select count(*) from jsonb_array_elements(p_votes) x where x->>'source_owner_key'=v->>'source_owner_key' and x->>'sentiment'='negative') then raise exception 'vote_counts_do_not_reconcile';end if;
 end loop;
 insert into public.clickdesk_official_capture_audit(period_start,period_end,metrics,votes)
 select start_day,end_day,coalesce((select jsonb_agg(to_jsonb(m)) from public.clickdesk_official_period_metrics m where m.period_start=start_day and m.period_end=end_day),'[]'::jsonb),coalesce((select jsonb_agg(to_jsonb(pv)) from public.clickdesk_official_period_votes pv where pv.period_start=start_day and pv.period_end=end_day),'[]'::jsonb);
 delete from public.clickdesk_official_period_votes where period_start=start_day and period_end=end_day;
 for v in select value from jsonb_array_elements(p_votes) loop
  select ca.id,ca.team_id into a from public.chat_analysts ca join public.clickdesk_official_owner_registry r on r.active and r.source_owner_key=v->>'source_owner_key'
  where ca.active and lower(regexp_replace(translate(trim(ca.name),'ÁÀÃÂÄáàãâäÉÈÊËéèêëÍÌÎÏíìîïÓÒÕÔÖóòõôöÚÙÛÜúùûüÇç','AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'),'[^a-zA-Z0-9]+',' ','g'))=r.source_owner_key;
  if a.id is null then raise exception 'vote_owner_not_registered';end if;
  source:=jsonb_build_object('ticket_id',v->>'ticket_id','ticket_number',v->>'ticket_number','analyst_id',a.id,'team_id',a.team_id,
   'rated_at',v->>'rated_at','occurred_date',((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date,'sentiment',v->>'sentiment','original_label',v->>'original_label');
  hash:=encode(extensions.digest(convert_to(source::text,'UTF8'),'sha256'),'hex');
  -- Reuse an existing evidence hash only when every original rating field is identical.
  select coalesce((select e.source_hash from public.clickdesk_event_ratings e where e.ticket_id=v->>'ticket_id' and e.ticket_number=v->>'ticket_number'
   and e.analyst_id=a.id and e.team_id=a.team_id and e.rated_at=(v->>'rated_at')::timestamptz and e.sentiment=v->>'sentiment' and e.original_label=v->>'original_label'),hash) into hash;
  -- Append missing evidence only. Existing ratings and reviews are never updated.
  insert into public.clickdesk_event_ratings(ticket_id,ticket_number,analyst_id,team_id,rated_at,occurred_date,sentiment,original_label,source_hash)
  values(v->>'ticket_id',v->>'ticket_number',a.id,a.team_id,(v->>'rated_at')::timestamptz,((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date,v->>'sentiment',v->>'original_label',hash) on conflict(ticket_id) do nothing;
  if v->>'original_label'='Neutro' and v->>'sentiment'='negative' and exists(select 1 from public.clickdesk_event_ratings e where e.ticket_id=v->>'ticket_id' and e.source_hash=hash) then
   insert into public.clickdesk_neutral_reviews(ticket_id,analyst_id,source_hash) values(v->>'ticket_id',a.id,hash) on conflict(ticket_id) do nothing;
  end if;
  insert into public.clickdesk_official_period_votes(period_start,period_end,ticket_id,analyst_id,source_owner_key,sentiment,original_label,source_hash,ticket_number,team_id,rated_at,occurred_date) values(start_day,end_day,v->>'ticket_id',a.id,v->>'source_owner_key',v->>'sentiment',v->>'original_label',hash,v->>'ticket_number',a.team_id,(v->>'rated_at')::timestamptz,((v->>'rated_at')::timestamptz at time zone 'America/Sao_Paulo')::date);
 end loop;
 insert into public.clickdesk_official_period_metrics select * from jsonb_populate_recordset(null::public.clickdesk_official_period_metrics,p_rows)
 on conflict(period_start,period_end,source_owner_key,source_scope) do update set attendances=excluded.attendances,replies=excluded.replies,resolved=excluded.resolved,
 positive_reviews=excluded.positive_reviews,negative_reviews=excluded.negative_reviews,captured_at=excluded.captured_at,source_note=excluded.source_note,attendance_basis=excluded.attendance_basis;
 insert into public.clickdesk_official_capture_audit(period_start,period_end,metrics,votes) select start_day,end_day,p_rows,coalesce(jsonb_agg(to_jsonb(pv)),'[]'::jsonb) from public.clickdesk_official_period_votes pv where pv.period_start=start_day and pv.period_end=end_day;
 return true;
end $function$;
revoke all on function public."publish_clickdesk_official_capture"(p_rows jsonb, p_votes jsonb) from public,anon,authenticated;
grant execute on function public."publish_clickdesk_official_capture"(p_rows jsonb, p_votes jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.record_clickdesk_event_source_deletion(p_ticket text, p_lease uuid, p_deleted_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q public.clickdesk_event_capture_queue;
begin
 select * into q from public.clickdesk_event_capture_queue where ticket_id=p_ticket for update;
 if not found or q.lease_token is distinct from p_lease or p_deleted_at is null then return false; end if;
 insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash)
 values(p_ticket,'source_deleted','{}',jsonb_build_object('deleted_at',p_deleted_at,'evidence','GET /tickets?inbox=all&view=deleted'),md5(p_deleted_at::text)) on conflict do nothing;
 insert into public.clickdesk_event_ticket_history(ticket_id,source_version,events) values(p_ticket,q.source_version,'[]')
 on conflict do nothing;
 update public.clickdesk_event_capture_queue set status='complete',error_code='source_deleted',captured_at=now(),lease_until=null,lease_token=null where ticket_id=p_ticket;
 return true;
end $function$;
revoke all on function public."record_clickdesk_event_source_deletion"(p_ticket text, p_lease uuid, p_deleted_at timestamp with time zone) from public,anon,authenticated;
grant execute on function public."record_clickdesk_event_source_deletion"(p_ticket text, p_lease uuid, p_deleted_at timestamp with time zone) to service_role;

CREATE OR REPLACE FUNCTION public.record_clickdesk_outside_period_proofs(p_period text, p_rows jsonb, p_hash text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare affected integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>128 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid period proof';end if;
 update public.clickdesk_period_inventory_candidates c
 set last_public_at=x.last_public_at,outside_period_verified_at=now(),outside_period_evidence_hash=p_hash
 from jsonb_to_recordset(p_rows)x(ticket_id text,last_public_at timestamptz,source_version timestamptz),public.clickdesk_period_inventory r
 where c.period_key=p_period and r.period_key=c.period_key and c.ticket_id=x.ticket_id
 and isfinite(x.last_public_at) and isfinite(x.source_version)
 and c.source_updated_at<=x.source_version
 and (x.last_public_at at time zone 'America/Sao_Paulo')::date<r.start_date
 and exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=c.ticket_id and p.reason='final_author_ambiguous');
 get diagnostics affected=row_count;
 return affected;
end $function$;
revoke all on function public."record_clickdesk_outside_period_proofs"(p_period text, p_rows jsonb, p_hash text) from public,anon,authenticated;
grant execute on function public."record_clickdesk_outside_period_proofs"(p_period text, p_rows jsonb, p_hash text) to service_role;

CREATE OR REPLACE FUNCTION public.record_clickdesk_source_deletions(p_rows jsonb, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>32 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid deletion evidence';end if;
 with inserted as(
 insert into public.clickdesk_source_exclusions(ticket_id,reason,source_deleted_at,evidence_hash)
 select r.ticket_id,'deleted_in_source',r.deleted_at,p_hash from jsonb_to_recordset(p_rows)as r(ticket_id text,deleted_at timestamptz)
 where r.ticket_id ~ '^[0-9]{1,25}$' and r.deleted_at<=now() and not exists(select 1 from public.clickdesk_final_ticket_ledger l where l.ticket_id=r.ticket_id)
 and (exists(select 1 from public.clickdesk_chat_capture_queue c where c.ticket_id=r.ticket_id)or exists(select 1 from public.clickdesk_chat_attendances c where c.clickdesk_ticket_id=r.ticket_id))
 on conflict(ticket_id)do update set source_deleted_at=excluded.source_deleted_at,evidence_hash=excluded.evidence_hash,verified_at=now()
 returning ticket_id)
 select coalesce(jsonb_agg(ticket_id),'[]'::jsonb)into result from inserted;
 return result;
end $function$;
revoke all on function public."record_clickdesk_source_deletions"(p_rows jsonb, p_hash text) from public,anon,authenticated;
grant execute on function public."record_clickdesk_source_deletions"(p_rows jsonb, p_hash text) to service_role;

CREATE OR REPLACE FUNCTION public.refresh_clickdesk_360_queue(p_start date, p_end date, p_team uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare affected integer;
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period'; end if;
 insert into public.clickdesk_360_work_queue(ticket_id,analyst_id,team_id,occurred_date,satisfaction_label)
 select l.ticket_id,l.analyst_id,l.team_id,l.occurred_date,l.satisfaction_label
 from public.clickdesk_final_ticket_ledger l
 join public.chat_analysts a on a.id=l.analyst_id and a.active
 left join public.clickdesk_qualitative_analyses q on q.clickdesk_ticket_id=l.ticket_id
  and q.analyst_id=l.analyst_id and q.occurred_date=l.occurred_date and q.satisfaction_label=l.satisfaction_label
 where l.occurred_date between p_start and p_end and (p_team is null or l.team_id=p_team)
 and l.satisfaction_label in ('positive','negative')
 and not exists(select 1 from public.clickdesk_final_ticket_pending p where p.ticket_id=l.ticket_id)
 and not (q.id is not null and (q.validation_status='rejected' or coalesce(q.analysis->>'_analysis_version','0') ~ '^[0-9]+$'
    and coalesce(q.analysis->>'_analysis_version','0')::integer>=2))
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,
 occurred_date=excluded.occurred_date,satisfaction_label=excluded.satisfaction_label,
 status='pending',attempts=0,lease_token=null,lease_until=null,next_attempt_at=now(),error_code=null,updated_at=now()
 where clickdesk_360_work_queue.analyst_id is distinct from excluded.analyst_id
 or clickdesk_360_work_queue.satisfaction_label is distinct from excluded.satisfaction_label
 or clickdesk_360_work_queue.occurred_date is distinct from excluded.occurred_date
 or clickdesk_360_work_queue.status='done';
 get diagnostics affected=row_count;
 -- Cache reuse and editorial discard never produce another provider call.
 update public.clickdesk_360_work_queue w set status='done',lease_token=null,lease_until=null,
 completed_at=coalesce(w.completed_at,now()),updated_at=now()
 where w.status in ('pending','failed') and exists(
 select 1 from public.clickdesk_qualitative_analyses q where q.clickdesk_ticket_id=w.ticket_id
 and q.analyst_id=w.analyst_id and q.occurred_date=w.occurred_date and q.satisfaction_label=w.satisfaction_label
 and (q.validation_status='rejected' or coalesce(q.analysis->>'_analysis_version','0')::integer>=2));
 return affected;
end $function$;
revoke all on function public."refresh_clickdesk_360_queue"(p_start date, p_end date, p_team uuid) from public,anon,authenticated;
grant execute on function public."refresh_clickdesk_360_queue"(p_start date, p_end date, p_team uuid) to service_role;

CREATE OR REPLACE FUNCTION public.request_clickdesk_official_period(p_start date, p_end date)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare last_request timestamptz;
begin
 if auth.uid() is null or not(public.is_management_user() or public.current_user_chat_analyst_id() is not null) then raise exception 'unauthorized' using errcode='42501';end if;
 if p_start is null or p_end is null or p_start<date '2026-10-01' or p_start>p_end or p_end>(now() at time zone 'America/Sao_Paulo')::date or date_trunc('month',p_start)<>date_trunc('month',p_end) then raise exception 'invalid_period';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from public.clickdesk_official_period_requests where requested_by=auth.uid() and requested_at>now()-interval '1 minute')>=3 then return false;end if;
 insert into public.clickdesk_official_period_requests(period_start,period_end,requested_at) values(p_start,p_end,now()-interval '1 hour') on conflict do nothing;
 select requested_at into last_request from public.clickdesk_official_period_requests where period_start=p_start and period_end=p_end for update;
 if last_request>now()-interval '90 seconds' then return false;end if;
 update public.clickdesk_official_period_requests set requested_at=now(),requested_by=auth.uid() where period_start=p_start and period_end=p_end;
 perform net.http_post(url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-official-metrics-sync',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),body:=jsonb_build_object('start',p_start,'end',p_end),timeout_milliseconds:=120000);
 return true;
end $function$;
revoke all on function public."request_clickdesk_official_period"(p_start date, p_end date) from public,anon,authenticated;
grant execute on function public."request_clickdesk_official_period"(p_start date, p_end date) to service_role;
grant execute on function public."request_clickdesk_official_period"(p_start date, p_end date) to authenticated;

CREATE OR REPLACE FUNCTION public.retry_clickdesk_capture_unit(p_job_id uuid, p_key text, p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare accepted integer;
begin
 perform 1 from public.clickdesk_official_capture_jobs j where j.id=p_job_id and j.status='running' for update;
 if not found then return false;end if;
 update public.clickdesk_official_capture_tasks t
 set status=case when t.attempts>=5 then 'failed' else 'pending' end,
 next_attempt_at=clock_timestamp()+make_interval(secs=>30*power(2,t.attempts-1)::integer),
 lease_token=null,lease_until=null,error_code='capture_unit_failed'
 where t.job_id=p_job_id and t.task_key=p_key and t.status='running'
 and t.lease_token=p_token and t.lease_until>clock_timestamp()
 and exists(select 1 from public.clickdesk_official_capture_jobs j where j.id=t.job_id and j.status='running');
 get diagnostics accepted=row_count;
 return accepted=1;
end $function$;
revoke all on function public."retry_clickdesk_capture_unit"(p_job_id uuid, p_key text, p_token uuid) from public,anon,authenticated;
grant execute on function public."retry_clickdesk_capture_unit"(p_job_id uuid, p_key text, p_token uuid) to service_role;

CREATE OR REPLACE FUNCTION public.save_clickdesk_event_rating(p_row jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.clickdesk_event_ratings; old_row public.clickdesk_event_ratings;
begin
 r:=jsonb_populate_record(null::public.clickdesk_event_ratings,p_row);
 select * into old_row from public.clickdesk_event_ratings where ticket_id=r.ticket_id for update;
 if found and old_row.source_hash<>r.source_hash and old_row.occurred_date<(now() at time zone 'America/Sao_Paulo')::date then
  insert into public.clickdesk_event_corrections(ticket_id,kind,previous,proposed,source_hash) values(r.ticket_id,'closed_rating_changed',to_jsonb(old_row),p_row,r.source_hash) on conflict do nothing;
  return;
 end if;
 insert into public.clickdesk_event_ratings(ticket_id,ticket_number,analyst_id,team_id,rated_at,occurred_date,sentiment,original_label,source_hash)
 values(r.ticket_id,r.ticket_number,r.analyst_id,r.team_id,r.rated_at,r.occurred_date,r.sentiment,r.original_label,r.source_hash)
 on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,team_id=excluded.team_id,rated_at=excluded.rated_at,occurred_date=excluded.occurred_date,
 sentiment=excluded.sentiment,original_label=excluded.original_label,source_hash=excluded.source_hash,captured_at=now();
 if lower(r.original_label)='neutro' and r.sentiment='negative' then
  insert into public.clickdesk_neutral_reviews(ticket_id,analyst_id,source_hash) values(r.ticket_id,r.analyst_id,r.source_hash)
  on conflict(ticket_id) do update set analyst_id=excluded.analyst_id,source_hash=excluded.source_hash,
  status=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then 'pending' else clickdesk_neutral_reviews.status end,
  exclusion_eligible=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then false else clickdesk_neutral_reviews.exclusion_eligible end,
  attempts=case when clickdesk_neutral_reviews.source_hash<>excluded.source_hash then 0 else clickdesk_neutral_reviews.attempts end;
 end if;
end $function$;
revoke all on function public."save_clickdesk_event_rating"(p_row jsonb) from public,anon,authenticated;
grant execute on function public."save_clickdesk_event_rating"(p_row jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.save_clickdesk_inventory_page(p_period text, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.clickdesk_period_inventory;
begin
 select * into r from public.clickdesk_period_inventory where period_key=p_period for update;
 if not found then raise exception 'Inventory not found'; end if;
 insert into public.clickdesk_period_inventory_pages values(p_period,p_pass,p_page,p_hash,p_count,p_total)
 on conflict(period_key,pass,page) do update set page_hash=excluded.page_hash,item_count=excluded.item_count,total_items=excluded.total_items;
 insert into public.clickdesk_period_inventory_candidates(period_key,ticket_id,source_updated_at,last_seen_pass)
 select p_period,x.ticket_id,x.source_updated_at,p_pass from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(period_key,ticket_id) do update set source_updated_at=greatest(clickdesk_period_inventory_candidates.source_updated_at,excluded.source_updated_at),last_seen_pass=excluded.last_seen_pass;
 insert into public.clickdesk_chat_capture_queue(ticket_id,period_start,period_end,discovered_page,status,source_updated_at)
 select x.ticket_id,r.start_date,r.cutoff_date,p_page,'pending',x.source_updated_at
 from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(ticket_id) do update set
 period_start=least(clickdesk_chat_capture_queue.period_start,excluded.period_start),
 period_end=greatest(clickdesk_chat_capture_queue.period_end,excluded.period_end),
 source_updated_at=greatest(clickdesk_chat_capture_queue.source_updated_at,excluded.source_updated_at),
 status=case when excluded.source_updated_at>coalesce(clickdesk_chat_capture_queue.source_updated_at,'-infinity'::timestamptz) then 'pending' else clickdesk_chat_capture_queue.status end;
end $function$;
revoke all on function public."save_clickdesk_inventory_page"(p_period text, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb) from public,anon,authenticated;
grant execute on function public."save_clickdesk_inventory_page"(p_period text, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.save_clickdesk_inventory_partition_page(p_partition uuid, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.clickdesk_period_inventory; part public.clickdesk_inventory_partitions;
begin
 select * into part from public.clickdesk_inventory_partitions where id=p_partition for update;
 select * into r from public.clickdesk_period_inventory where period_key=part.period_key;
 insert into public.clickdesk_inventory_partition_pages values(p_partition,p_pass,p_page,p_hash,p_count,p_total)
 on conflict(partition_id,pass,page) do update set page_hash=excluded.page_hash,item_count=excluded.item_count,total_items=excluded.total_items;
 insert into public.clickdesk_period_inventory_candidates(period_key,ticket_id,source_updated_at,last_seen_pass)
 select part.period_key,x.ticket_id,x.source_updated_at,p_pass from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(period_key,ticket_id) do update set source_updated_at=greatest(clickdesk_period_inventory_candidates.source_updated_at,excluded.source_updated_at),last_seen_pass=excluded.last_seen_pass;
 insert into public.clickdesk_chat_capture_queue(ticket_id,period_start,period_end,discovered_page,status,source_updated_at)
 select x.ticket_id,r.start_date,r.cutoff_date,p_page,'pending',x.source_updated_at
 from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(ticket_id) do update set
 period_start=least(clickdesk_chat_capture_queue.period_start,excluded.period_start),
 period_end=greatest(clickdesk_chat_capture_queue.period_end,excluded.period_end),
 source_updated_at=greatest(clickdesk_chat_capture_queue.source_updated_at,excluded.source_updated_at),
 status=case when excluded.source_updated_at>coalesce(clickdesk_chat_capture_queue.source_updated_at,'-infinity'::timestamptz) then 'pending' else clickdesk_chat_capture_queue.status end;
end $function$;
revoke all on function public."save_clickdesk_inventory_partition_page"(p_partition uuid, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb) from public,anon,authenticated;
grant execute on function public."save_clickdesk_inventory_partition_page"(p_partition uuid, p_pass integer, p_page integer, p_hash text, p_count integer, p_total integer, p_rows jsonb) to service_role;
create policy "management_read_360_requests" on public."clickdesk_360_requests" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_360_requests" to authenticated;
create policy "management_read_360_work_queue" on public."clickdesk_360_work_queue" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_360_work_queue" to authenticated;
create policy "management_read_360_worker_health" on public."clickdesk_360_worker_health" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_360_worker_health" to authenticated;
create policy "clickdesk_chat_links_management" on public."clickdesk_chat_analyst_links" as permissive for all to "authenticated" using (( SELECT is_management_user() AS is_management_user)) with check (( SELECT is_management_user() AS is_management_user));
grant select,insert,update,delete on public."clickdesk_chat_analyst_links" to authenticated;
create policy "clickdesk_chat_area_links_management" on public."clickdesk_chat_area_links" as permissive for all to "authenticated" using (( SELECT is_management_user() AS is_management_user)) with check (( SELECT is_management_user() AS is_management_user));
grant select,insert,update,delete on public."clickdesk_chat_area_links" to authenticated;
create policy "clickdesk_chat_attendances_management_insert" on public."clickdesk_chat_attendances" as permissive for insert to "authenticated" with check (( SELECT is_management_user() AS is_management_user));
grant insert on public."clickdesk_chat_attendances" to authenticated;
create policy "clickdesk_chat_attendances_management_update" on public."clickdesk_chat_attendances" as permissive for update to "authenticated" using (( SELECT is_management_user() AS is_management_user)) with check (( SELECT is_management_user() AS is_management_user));
grant update on public."clickdesk_chat_attendances" to authenticated;
create policy "clickdesk_chat_attendances_management_or_self_select" on public."clickdesk_chat_attendances" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR ((analyst_id IS NOT NULL) AND (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id)))));
grant select on public."clickdesk_chat_attendances" to authenticated;
create policy "clickdesk_daily_resolutions_management_or_self_select" on public."clickdesk_chat_daily_resolutions" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_chat_daily_resolutions" to authenticated;
create policy "clickdesk_report_snapshots_management_read" on public."clickdesk_chat_report_snapshots" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_chat_report_snapshots" to authenticated;
create policy "clickdesk_chat_sync_runs_management_select" on public."clickdesk_chat_sync_runs" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_chat_sync_runs" to authenticated;
create policy "clickdesk_chat_sync_runs_management_insert" on public."clickdesk_chat_sync_runs" as permissive for insert to "authenticated" with check (( SELECT is_management_user() AS is_management_user));
grant insert on public."clickdesk_chat_sync_runs" to authenticated;
create policy "clickdesk_chat_sync_runs_management_update" on public."clickdesk_chat_sync_runs" as permissive for update to "authenticated" using (( SELECT is_management_user() AS is_management_user)) with check (( SELECT is_management_user() AS is_management_user));
grant update on public."clickdesk_chat_sync_runs" to authenticated;
create policy "clickdesk_verified_management_or_self_select" on public."clickdesk_chat_verified_contributions" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_chat_verified_contributions" to authenticated;
create policy "published_scope" on public."clickdesk_event_published_daily" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_event_published_daily" to authenticated;
create policy "rating_scope" on public."clickdesk_event_ratings" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_event_ratings" to authenticated;
create policy "receipt_scope" on public."clickdesk_event_receipts" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_event_receipts" to authenticated;
create policy "clickdesk_final_coverage_management_select" on public."clickdesk_final_coverage" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_final_coverage" to authenticated;
create policy "clickdesk_final_ledger_manager_or_owner_select" on public."clickdesk_final_ticket_ledger" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_final_ticket_ledger" to authenticated;
create policy "clickdesk_final_pending_manager_or_own_select" on public."clickdesk_final_ticket_pending" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (EXISTS ( SELECT 1
   FROM clickdesk_final_ticket_ledger ledger
  WHERE ((ledger.ticket_id = clickdesk_final_ticket_pending.ticket_id) AND (ledger.analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id)))))));
grant select on public."clickdesk_final_ticket_pending" to authenticated;
create policy "management_inventory_assessment" on public."clickdesk_inventory_assessment" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_inventory_assessment" to authenticated;
create policy "management_inventory_partition_pages" on public."clickdesk_inventory_partition_pages" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_inventory_partition_pages" to authenticated;
create policy "management_inventory_partitions" on public."clickdesk_inventory_partitions" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_inventory_partitions" to authenticated;
create policy "neutral_attempt_scope" on public."clickdesk_neutral_review_attempts" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (EXISTS ( SELECT 1
   FROM clickdesk_event_ratings r
  WHERE ((r.ticket_id = clickdesk_neutral_review_attempts.ticket_id) AND (r.analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id)))))));
grant select on public."clickdesk_neutral_review_attempts" to authenticated;
create policy "neutral_scope" on public."clickdesk_neutral_reviews" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_neutral_reviews" to authenticated;
create policy "official_votes_scope" on public."clickdesk_official_period_votes" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_official_period_votes" to authenticated;
create policy "management_inventory" on public."clickdesk_period_inventory" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_period_inventory" to authenticated;
create policy "management_inventory_candidates" on public."clickdesk_period_inventory_candidates" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_period_inventory_candidates" to authenticated;
create policy "management_inventory_pages" on public."clickdesk_period_inventory_pages" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_period_inventory_pages" to authenticated;
create policy "management can insert qualitative analyses" on public."clickdesk_qualitative_analyses" as permissive for insert to "authenticated" with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (lower((p.role)::text) = ANY (ARRAY['master'::text, 'coordenadora'::text, 'coordinator'::text]))))));
grant insert on public."clickdesk_qualitative_analyses" to authenticated;
create policy "management can update qualitative analyses" on public."clickdesk_qualitative_analyses" as permissive for update to "authenticated" using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (lower((p.role)::text) = ANY (ARRAY['master'::text, 'coordenadora'::text, 'coordinator'::text])))))) with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (lower((p.role)::text) = ANY (ARRAY['master'::text, 'coordenadora'::text, 'coordinator'::text]))))));
grant update on public."clickdesk_qualitative_analyses" to authenticated;
create policy "authorized users can read qualitative analyses" on public."clickdesk_qualitative_analyses" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant select on public."clickdesk_qualitative_analyses" to authenticated;
create policy "analysts can insert own qualitative analyses" on public."clickdesk_qualitative_analyses" as permissive for insert to "authenticated" with check (((validation_status = 'pending'::text) AND (validated_by IS NULL) AND (validated_at IS NULL) AND (created_by = ( SELECT auth.uid() AS uid)) AND (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));
grant insert on public."clickdesk_qualitative_analyses" to authenticated;
create policy "clickdesk_qualitative_skips_management_select" on public."clickdesk_qualitative_skips" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_qualitative_skips" to authenticated;
create policy "source_exclusions_management_read" on public."clickdesk_source_exclusions" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));
grant select on public."clickdesk_source_exclusions" to authenticated;

-- Tighten only Chat reads; preserve existing write policies and workforce triggers.
drop policy "chat_analysts_select_authenticated" on public."chat_analysts";
create policy "chat_analysts_select_management_or_self" on public."chat_analysts" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));

-- Tighten only Chat reads; preserve existing write policies and workforce triggers.
drop policy "chat_monthly_metrics_select_authenticated" on public."chat_monthly_metrics";
create policy "chat_monthly_metrics_select_management_or_self" on public."chat_monthly_metrics" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (analyst_id = ( SELECT current_user_chat_analyst_id() AS current_user_chat_analyst_id))));

-- Tighten only Chat reads; preserve existing write policies and workforce triggers.
drop policy "chat_podium_exclusions_select_authenticated" on public."chat_podium_exclusions";
create policy "chat_podium_exclusions_select_management" on public."chat_podium_exclusions" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));

-- Tighten only Chat reads; preserve existing write policies and workforce triggers.
drop policy "chat_podium_manual_select_authenticated" on public."chat_podium_manual";
drop policy "chat_podium_manual_select_management" on public."chat_podium_manual";
create policy "chat_podium_manual_select_management" on public."chat_podium_manual" as permissive for select to "authenticated" using (( SELECT is_management_user() AS is_management_user));

-- Tighten only Chat reads; preserve existing write policies and workforce triggers.
drop policy "chat_teams_select_authenticated" on public."chat_teams";
create policy "chat_teams_select_management_or_self" on public."chat_teams" as permissive for select to "authenticated" using ((( SELECT is_management_user() AS is_management_user) OR (id = ( SELECT current_user_chat_team_id() AS current_user_chat_team_id))));
CREATE TRIGGER clickdesk_360_new_confirmed_ticket AFTER INSERT ON public.clickdesk_final_ticket_ledger FOR EACH ROW EXECUTE FUNCTION enqueue_clickdesk_360_on_ledger_insert();
CREATE TRIGGER clickdesk_360_source_changed AFTER UPDATE ON public.clickdesk_final_ticket_ledger FOR EACH ROW EXECUTE FUNCTION invalidate_clickdesk_360_on_source_change();
CREATE TRIGGER clickdesk_registry_name_changed AFTER INSERT OR UPDATE OF name, legacy_name ON public.chat_analysts FOR EACH ROW EXECUTE FUNCTION note_clickdesk_registry_revision();

-- No initial registry identities/links, no secrets and no schedule activation in this schema phase.
set local check_function_bodies=on;
commit;


-- REVIEW ONLY. Revert new Chat schedules/read policies, preserve all business records and new tables.
begin;
select cron.unschedule(jobid) from cron.job where jobname in('clickdesk-official-capture-30m','clickdesk-official-durable-worker');
drop policy if exists "chat_analysts_select_management_or_self" on public."chat_analysts";
create policy "chat_analysts_select_authenticated" on public."chat_analysts" as permissive for select to "authenticated" using (true);
drop policy if exists "chat_monthly_metrics_select_management_or_self" on public."chat_monthly_metrics";
create policy "chat_monthly_metrics_select_authenticated" on public."chat_monthly_metrics" as permissive for select to "authenticated" using (true);
drop policy if exists "chat_podium_exclusions_select_management" on public."chat_podium_exclusions";
create policy "chat_podium_exclusions_select_authenticated" on public."chat_podium_exclusions" as permissive for select to "authenticated" using (true);
drop policy if exists "chat_podium_manual_select_management" on public."chat_podium_manual";
create policy "chat_podium_manual_select_authenticated" on public."chat_podium_manual" as permissive for select to "authenticated" using (true);
create policy "chat_podium_manual_select_management" on public."chat_podium_manual" as permissive for select to "authenticated" using (is_management_user());
drop policy if exists "chat_teams_select_management_or_self" on public."chat_teams";
create policy "chat_teams_select_authenticated" on public."chat_teams" as permissive for select to "authenticated" using (true);
commit;
-- Restore the previous production application deployment separately. Do not DROP new tables or overwrite historical data.


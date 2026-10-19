create function public.set_clickdesk_recovery_cadence(p_recovering boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform cron.alter_job(job_id:=(select jobid from cron.job where jobname='clickdesk-verified-discover-hourly'),schedule:=case when p_recovering then '*/2 12-22 * * *' else '*/5 12-22 * * *' end);
end $$;
revoke all on function public.set_clickdesk_recovery_cadence(boolean) from public,anon,authenticated;
grant execute on function public.set_clickdesk_recovery_cadence(boolean) to service_role;
select public.set_clickdesk_recovery_cadence(true);
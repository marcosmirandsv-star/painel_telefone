create or replace function public.set_clickdesk_recovery_cadence(p_recovering boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not p_recovering and (
 exists(select 1 from public.clickdesk_period_inventory where period_key=to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM') and status<>'complete')
 or coalesce((public.get_clickdesk_reconciliation_batch(1,false,null,null)->>'backlog_before')::bigint,0)>0
 ) then return; end if;
 perform cron.alter_job(job_id:=(select jobid from cron.job where jobname='clickdesk-verified-discover-hourly'),schedule:=case when p_recovering then '*/2 12-22 * * *' else '*/5 12-22 * * *' end);
 perform cron.alter_job(job_id:=(select jobid from cron.job where jobname='clickdesk-ledger-incremental-every-5m'),schedule:=case when p_recovering then '*/2 12-22 * * *' else '*/5 12-22 * * *' end);
end $$;
select public.set_clickdesk_recovery_cadence(true);
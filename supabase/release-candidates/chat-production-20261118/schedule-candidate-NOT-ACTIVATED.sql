-- REVIEW ONLY, NOT ACTIVATED. Execute only after Edge auth and a real complete publication are validated.
begin;
do $guard$ begin
if not exists(select 1 from vault.secrets where name='clickdesk_cron_token') then raise exception 'Missing production credentials';end if;
if exists(select 1 from cron.job where jobname in('clickdesk-official-capture-30m','clickdesk-official-durable-worker')) then raise exception 'Existing schedule requires explicit comparison';end if;
end $guard$;
select cron.schedule('clickdesk-official-capture-30m','0,30 * * * *',$command$select net.http_post(url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-official-metrics-sync',headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),body:=jsonb_build_object('start',ranges.period_start::text,'end',ranges.period_end::text),timeout_milliseconds:=180000) from (select date_trunc('month',now() at time zone 'America/Sao_Paulo')::date period_start,(now() at time zone 'America/Sao_Paulo')::date period_end union select recent.period_start,recent.period_end from (select period_start,period_end from public.clickdesk_official_period_metrics where period_start>=date '2026-11-01' and captured_at>now()-interval '1 day' group by period_start,period_end order by max(captured_at) desc limit 5)recent)ranges;$command$);
select cron.schedule('clickdesk-official-durable-worker','* * * * *',$command$
select net.http_post(
 url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-official-metrics-sync',
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),
 body:='{"action":"work"}'::jsonb,timeout_milliseconds:=180000)
from generate_series(1,greatest(0,2-(select count(*)::integer from public.clickdesk_official_capture_tasks where status='running' and lease_until>now())))
where exists(select 1 from public.clickdesk_official_capture_jobs where status in ('pending','running'));
$command$);
commit;


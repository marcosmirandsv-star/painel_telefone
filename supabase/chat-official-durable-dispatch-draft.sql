-- Applied ONLY to HML vvtorcvchnqhcredhorv as chat_official_durable_dispatch_20261116. Do not reapply.
select cron.schedule('clickdesk-official-durable-worker','* * * * *',$cron$
select net.http_post(
 url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-official-metrics-sync',
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),
 body:='{"action":"work"}'::jsonb,timeout_milliseconds:=90000)
from generate_series(1,greatest(0,4-(select count(*)::integer from public.clickdesk_official_capture_tasks where status='running' and lease_until>now())))
where exists(select 1 from public.clickdesk_official_capture_jobs where status in ('pending','running'));
$cron$);

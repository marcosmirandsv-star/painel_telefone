select cron.schedule('clickdesk-official-capture-30m','0,30 * * * *',$cron$
select net.http_post(
 url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-official-metrics-sync',
 headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),
 body:=jsonb_build_object('start',ranges.period_start::text,'end',ranges.period_end::text),timeout_milliseconds:=180000)
from (
 select date_trunc('month',now() at time zone 'America/Sao_Paulo')::date period_start,(now() at time zone 'America/Sao_Paulo')::date period_end
 union select recent.period_start,recent.period_end from (
 select period_start,period_end from public.clickdesk_official_period_metrics
 where period_start>=date '2026-11-01' and captured_at>now()-interval '1 day'
 group by period_start,period_end order by max(captured_at) desc limit 5)recent
)ranges;
$cron$);
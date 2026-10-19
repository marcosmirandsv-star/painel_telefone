
select cron.schedule('clickdesk-monthly-final-inventory','10,15,20 3 1 * *',$cron$
select net.http_post(url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-period-inventory',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token')),
body:=jsonb_build_object('month',to_char((now() at time zone 'America/Sao_Paulo')::date-interval '1 month','YYYY-MM'),'restart',true),timeout_milliseconds:=20000);
select net.http_post(url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-ledger-incremental',
headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token')),
body:=jsonb_build_object('dry_run',false,'commit_verified',true,'limit',24),timeout_milliseconds:=120000);
$cron$);

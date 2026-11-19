-- Drives only queued investigations. Does not enqueue captures or enable Chat.
do $$ begin
 if not exists(select 1 from vault.secrets where name='clickdesk_cron_token') then raise exception 'Missing production worker credential';end if;
 if exists(select 1 from cron.job where jobname='clickdesk-capture-investigations') then raise exception 'Investigation schedule already exists; compare before replacing';end if;
end $$;
select cron.schedule('clickdesk-capture-investigations','* * * * *',$command$
 select net.http_post(
  url:='https://qmetbydkepfdgfqkdkai.supabase.co/functions/v1/clickdesk-official-metrics-sync',
  headers:=jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1),'Content-Type','application/json'),
  body:='{"action":"work"}'::jsonb,timeout_milliseconds:=180000)
 where exists(select 1 from public.clickdesk_capture_investigations
  where (status='pending' and next_attempt_at<=now()) or (status='running' and lease_until<=now()));
$command$);

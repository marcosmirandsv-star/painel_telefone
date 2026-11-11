-- Homologação only: refresh one closed day per cycle, oldest or missing first.
select cron.schedule('clickdesk-official-daily-every-5m','*/5 9-22 * * *',$job$
with cutoff as(select (now() at time zone 'America/Sao_Paulo')::date-1 as last_day),
day_to_refresh as(
 select d::date as day from cutoff,generate_series(date_trunc('month',last_day)::date,last_day,'1 day') d
 left join public.clickdesk_official_period_metrics m on m.period_start=d::date and m.period_end=d::date and m.source_scope='suporte_erp_fiscal'
 group by d order by min(m.captured_at) nulls first,d desc limit 1
)
select net.http_post(url:='https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-official-metrics-sync',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='clickdesk_cron_token' limit 1)),
 body:=jsonb_build_object('start',day::text,'end',day::text),timeout_milliseconds:=120000) from day_to_refresh;
$job$);
-- Keep existing monthly capture and authentication, start at 06h Brasília.
select cron.alter_job(job_id:=jobid,schedule:='*/5 9-22 * * *') from cron.job where jobname='clickdesk-official-metrics-every-5m';

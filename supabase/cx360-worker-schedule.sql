-- Production CX only. Provision cx360_worker_token in Vault before enabling.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create or replace function cx360_private.dispatch_worker() returns bigint
language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 if not exists(select 1 from public.cx360_ratings where active and eligible
   and rated_day between ((now() at time zone 'America/Sao_Paulo')::date-62) and ((now() at time zone 'America/Sao_Paulo')::date-1)
   and attempts<3 and next_attempt_at<=now()
   and (status='pending' or (status='processing' and lease_until<now()))) then return null;end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='cx360_worker_token';
 if token is null then raise exception 'CX worker credential missing';end if;
 select net.http_get(url:='https://painel-telefone.vercel.app/api/gestao-inteligente/worker',
   headers:=jsonb_build_object('Authorization','Bearer '||token),timeout_milliseconds:=15000) into request_id;
 return request_id;
end $$;
revoke all on function cx360_private.dispatch_worker() from public,anon,authenticated,service_role;
select cron.schedule('cx360-recover-pending','*/5 * * * *','select cx360_private.dispatch_worker();');

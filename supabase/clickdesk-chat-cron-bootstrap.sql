-- Bootstrap seguro da sincronização automática ClickDesk em homologação.
-- O primeiro sync manual copia as credenciais já configuradas no servidor para o Vault,
-- gera um token interno e agenda sincronizações intradiárias
-- de hora em hora, das 09:00 às 19:00 BRT.

begin;

create extension if not exists pg_net with schema extensions;

create index if not exists clickdesk_chat_area_links_team_idx
  on public.clickdesk_chat_area_links (team_id);

create or replace function public.bootstrap_clickdesk_cron_credentials(
  p_api_key text,
  p_account_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
  v_role text;
  v_job_id bigint;
begin
  v_role := public.current_user_role();
  if coalesce(v_role, '') not in ('master', 'coordenadora', 'coordinator') then
    raise exception 'Acesso exclusivo da gestão.' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_api_key, ''))) < 16 then
    raise exception 'Chave ClickDesk inválida.' using errcode = '22023';
  end if;

  if length(trim(coalesce(p_account_id, ''))) < 1 then
    raise exception 'Conta ClickDesk inválida.' using errcode = '22023';
  end if;

  select id into v_id
  from vault.decrypted_secrets
  where name = 'clickdesk_api_key'
  limit 1;

  if v_id is null then
    perform vault.create_secret(
      trim(p_api_key),
      'clickdesk_api_key',
      'Credencial ClickDesk para sincronização automática da homologação',
      null
    );
  else
    perform vault.update_secret(
      v_id,
      trim(p_api_key),
      'clickdesk_api_key',
      'Credencial ClickDesk para sincronização automática da homologação',
      null
    );
  end if;

  v_id := null;
  select id into v_id
  from vault.decrypted_secrets
  where name = 'clickdesk_account_id'
  limit 1;

  if v_id is null then
    perform vault.create_secret(
      trim(p_account_id),
      'clickdesk_account_id',
      'Conta ClickDesk para sincronização automática da homologação',
      null
    );
  else
    perform vault.update_secret(
      v_id,
      trim(p_account_id),
      'clickdesk_account_id',
      'Conta ClickDesk para sincronização automática da homologação',
      null
    );
  end if;

  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'clickdesk_cron_token'
  limit 1;

  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      v_token,
      'clickdesk_cron_token',
      'Token interno do cron ClickDesk da homologação',
      null
    );
  end if;

  -- Remove grades antigas antes de recriar a sincronização horária.
  for v_job_id in
    select jobid
    from cron.job
    where jobname in (
      'clickdesk-chat-intraday-0900',
      'clickdesk-chat-intraday-1300',
      'clickdesk-chat-intraday-1730',
      'clickdesk-chat-intraday-45-a',
      'clickdesk-chat-intraday-45-b',
      'clickdesk-chat-intraday-45-c',
      'clickdesk-chat-intraday-45-d',
      'clickdesk-chat-intraday-hourly',
      'clickdesk-chat-d1-sync'
    )
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'clickdesk-chat-intraday-hourly',
    '0 12-22 * * *',
    $cron$
      select net.http_post(
        url := 'https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-d1-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'clickdesk_cron_token'
            limit 1
          )
        ),
        body := jsonb_build_object('trigger', 'cron', 'mode', 'intraday', 'requested_at', now()),
        timeout_milliseconds := 120000
      );
    $cron$
  );

  return jsonb_build_object(
    'ready', true,
    'job_name', 'clickdesk-chat-intraday-hourly',
    'intraday_interval_minutes', 60,
    'intraday_window_brt', '09:00-19:00',
    'intraday_utc', jsonb_build_array('0 12-22 * * *')
  );
end;
$$;

revoke execute on function public.bootstrap_clickdesk_cron_credentials(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_clickdesk_cron_credentials(text, text)
  to authenticated;

create or replace function public.get_clickdesk_cron_credentials(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_api_key text;
  v_account_id text;
begin
  select decrypted_secret into v_expected
  from vault.decrypted_secrets
  where name = 'clickdesk_cron_token'
  limit 1;

  if v_expected is null
     or p_token is null
     or extensions.digest(p_token, 'sha256') <> extensions.digest(v_expected, 'sha256') then
    raise exception 'Token inválido.' using errcode = '42501';
  end if;

  select decrypted_secret into v_api_key
  from vault.decrypted_secrets
  where name = 'clickdesk_api_key'
  limit 1;

  select decrypted_secret into v_account_id
  from vault.decrypted_secrets
  where name = 'clickdesk_account_id'
  limit 1;

  if v_api_key is null or v_account_id is null then
    raise exception 'Credenciais ClickDesk ainda não inicializadas.' using errcode = '55000';
  end if;

  return jsonb_build_object('api_key', v_api_key, 'account_id', v_account_id);
end;
$$;

revoke execute on function public.get_clickdesk_cron_credentials(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_clickdesk_cron_credentials(text)
  to service_role;

commit;

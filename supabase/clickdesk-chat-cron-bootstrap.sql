-- Bootstrap seguro da sincronização automática ClickDesk em homologação.
-- O primeiro sync manual copia as credenciais já configuradas no servidor para o Vault,
-- gera um token interno e agenda o D-1 + revalidação recente às 06:10 BRT.

begin;

create extension if not exists pg_net with schema extensions;

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
      'Credencial ClickDesk para sincronização D-1 da homologação',
      null
    );
  else
    perform vault.update_secret(
      v_id,
      trim(p_api_key),
      'clickdesk_api_key',
      'Credencial ClickDesk para sincronização D-1 da homologação',
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
      'Conta ClickDesk para sincronização D-1 da homologação',
      null
    );
  else
    perform vault.update_secret(
      v_id,
      trim(p_account_id),
      'clickdesk_account_id',
      'Conta ClickDesk para sincronização D-1 da homologação',
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

  select cron.schedule(
    'clickdesk-chat-d1-sync',
    '10 9 * * *',
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
        body := jsonb_build_object('trigger', 'cron', 'requested_at', now()),
        timeout_milliseconds := 120000
      );
    $cron$
  ) into v_job_id;

  return jsonb_build_object(
    'ready', true,
    'job_name', 'clickdesk-chat-d1-sync',
    'job_id', v_job_id,
    'schedule_utc', '10 9 * * *',
    'schedule_brt', '06:10'
  );
end;
$$;

revoke all on function public.bootstrap_clickdesk_cron_credentials(text, text) from public;
grant execute on function public.bootstrap_clickdesk_cron_credentials(text, text) to authenticated;

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

revoke all on function public.get_clickdesk_cron_credentials(text) from public;
grant execute on function public.get_clickdesk_cron_credentials(text) to service_role;

commit;

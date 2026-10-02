-- Homologação: processamento automático e desacoplado da Análise 360º.
-- Roda 20 minutos após cada janela horária de sincronização do ClickDesk.
-- O token do Shareable Link fica somente no Vault e nunca é persistido no repositório.
-- A Vercel não recebe a service role da Supabase: leitura/gravação privilegiada
-- permanecem nas Edge Functions protegidas pelo token interno do cron.

create or replace function public.get_homologation_360_dispatch_config(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expected text;
  v_share_token text;
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

  select decrypted_secret into v_share_token
  from vault.decrypted_secrets
  where name = 'vercel_homologation_share_token'
  limit 1;

  if v_share_token is null then
    raise exception 'Share token da homologação não configurado.' using errcode = '55000';
  end if;

  return jsonb_build_object('share_token', v_share_token);
end;
$function$;

revoke all on function public.get_homologation_360_dispatch_config(text) from public;
revoke all on function public.get_homologation_360_dispatch_config(text) from anon;
revoke all on function public.get_homologation_360_dispatch_config(text) from authenticated;
grant execute on function public.get_homologation_360_dispatch_config(text) to service_role;

select cron.schedule(
  'clickdesk-chat-360-hourly',
  '20 12-22 * * *',
  $job$
    select net.http_post(
      url := 'https://vvtorcvchnqhcredhorv.supabase.co/functions/v1/clickdesk-360-dispatch',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'clickdesk_cron_token'
          limit 1
        )
      ),
      body := jsonb_build_object(
        'limit', 6,
        'requested_at', now()
      ),
      timeout_milliseconds := 115000
    );
  $job$
);

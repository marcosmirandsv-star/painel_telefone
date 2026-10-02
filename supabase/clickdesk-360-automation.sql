-- Homologação · automação da Análise 360º do ClickDesk
-- Mantém a sincronização principal em ciclo horário e escoa a fila qualitativa
-- em três lotes por hora, com até 8 tickets por lote.
--
-- Pré-requisitos:
--   - extensão pg_cron
--   - extensão pg_net
--   - secret "clickdesk_cron_token" no Vault
--   - Edge Function "clickdesk-360-dispatch" implantada na homologação
--
-- Observação:
--   o mesmo nome de job é reutilizado de forma idempotente; cron.schedule
--   faz upsert quando o jobname já existe.

select cron.schedule(
  'clickdesk-chat-360-hourly',
  '20,35,50 12-22 * * *',
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
        'limit', 8,
        'requested_at', now()
      ),
      timeout_milliseconds := 115000
    );
  $job$
);

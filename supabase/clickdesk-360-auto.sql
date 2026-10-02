-- Homologação: processamento automático e desacoplado da Análise 360º.
-- Roda 20 minutos após cada janela horária de sincronização do ClickDesk.
-- O Shareable Link fica somente no Vault e nunca é persistido no repositório.

select cron.schedule(
  'clickdesk-chat-360-hourly',
  '20 12-22 * * *',
  $job$
    select net.http_post(
      url := 'https://central-performance-git-homologacao-project-gestao.vercel.app/api/clickdesk/operation-360/auto-process?_vercel_share=' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'vercel_homologation_share_token'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'clickdesk_cron_token'
          limit 1
        ),
        'X-Central-Automation', 'clickdesk-sync'
      ),
      body := jsonb_build_object(
        'limit', 6,
        'requested_at', now()
      ),
      timeout_milliseconds := 100000
    );
  $job$
);

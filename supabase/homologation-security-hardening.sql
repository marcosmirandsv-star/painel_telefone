-- Hardening de segurança do ambiente de homologação.
-- Mantém helpers necessários às políticas disponíveis para authenticated,
-- remove exposição anônima/PUBLIC e protege a função chamada apenas pelo pg_cron.
--
-- Aplicado inicialmente no projeto Supabase de homologação:
-- vvtorcvchnqhcredhorv
--
-- Não aplicar em produção sem repetir a auditoria de dependências e permissões.

begin;

-- Helpers usados por RLS e backend autenticado: não precisam ser RPCs públicas/anônimas.
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.current_user_analyst_id() from public, anon;
revoke execute on function public.is_management_user() from public, anon;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_analyst_id() to authenticated;
grant execute on function public.is_management_user() to authenticated;

-- Esta função é chamada pelo pg_cron como usuário postgres.
-- Não deve ser invocável por clientes anon ou authenticated.
revoke execute on function public.process_schedule_transport_reminders(date)
  from public, anon, authenticated;

commit;

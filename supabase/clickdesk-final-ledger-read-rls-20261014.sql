-- Banco: Supabase de homologação vvtorcvchnqhcredhorv. Aplicado em 14/10/2026.
-- Corrige o HTTP 401 de leitura do ledger pela sessão autenticada do painel,
-- sem conceder escrita a usuário, nem abrir acesso público e sem alterar produção.
grant select on public.clickdesk_final_ticket_ledger to authenticated;
grant select on public.clickdesk_final_ticket_pending to authenticated;
grant select on public.clickdesk_final_coverage to authenticated;

drop policy if exists clickdesk_final_ledger_manager_or_owner_select on public.clickdesk_final_ticket_ledger;
create policy clickdesk_final_ledger_manager_or_owner_select on public.clickdesk_final_ticket_ledger
  for select to authenticated
  using ((select public.is_management_user())
    or analyst_id = (select public.current_user_chat_analyst_id()));

drop policy if exists clickdesk_final_pending_manager_or_own_select on public.clickdesk_final_ticket_pending;
create policy clickdesk_final_pending_manager_or_own_select on public.clickdesk_final_ticket_pending
  for select to authenticated
  using ((select public.is_management_user())
    or exists (
      select 1 from public.clickdesk_final_ticket_ledger as ledger
      where ledger.ticket_id = clickdesk_final_ticket_pending.ticket_id
        and ledger.analyst_id = (select public.current_user_chat_analyst_id())
    ));

drop policy if exists clickdesk_final_coverage_management_select on public.clickdesk_final_coverage;
create policy clickdesk_final_coverage_management_select on public.clickdesk_final_coverage
  for select to authenticated using ((select public.is_management_user()));

revoke insert, update, delete, truncate, references, trigger on
  public.clickdesk_final_ticket_ledger,
  public.clickdesk_final_ticket_pending,
  public.clickdesk_final_coverage
  from authenticated;

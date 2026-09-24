-- Acesso de gestão ao snapshot oficial ClickDesk.
-- Reusa integration_closures, que já possui unicidade por mês/canal/equipe
-- e trigger de imutabilidade para update/delete.

begin;

grant select, insert on public.integration_closures to authenticated;

drop policy if exists "integration_closures_management_select"
  on public.integration_closures;
create policy "integration_closures_management_select"
on public.integration_closures
for select
to authenticated
using ((select public.is_management_user()));

drop policy if exists "integration_closures_management_insert"
  on public.integration_closures;
create policy "integration_closures_management_insert"
on public.integration_closures
for insert
to authenticated
with check (
  (select public.is_management_user())
  and created_by = (select auth.uid())
);

commit;

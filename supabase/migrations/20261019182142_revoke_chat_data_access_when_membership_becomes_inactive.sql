create or replace function public.current_user_chat_analyst_id()
returns uuid language sql stable security definer set search_path='' as $$
 select p.chat_analyst_id from public.profiles p join public.chat_analysts a on a.id=p.chat_analyst_id where p.id=auth.uid() and a.active
$$;
revoke all on function public.current_user_chat_analyst_id() from public,anon;
grant execute on function public.current_user_chat_analyst_id() to authenticated;
alter policy "authorized users can read qualitative analyses" on public.clickdesk_qualitative_analyses using (
 (select public.is_management_user()) or analyst_id=(select public.current_user_chat_analyst_id())
);
alter policy "analysts can insert own qualitative analyses" on public.clickdesk_qualitative_analyses with check (
 validation_status='pending' and validated_by is null and validated_at is null and created_by=(select auth.uid()) and analyst_id=(select public.current_user_chat_analyst_id())
);

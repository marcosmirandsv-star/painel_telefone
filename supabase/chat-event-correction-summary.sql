create or replace function public.get_clickdesk_event_correction_summary()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.is_management_user() then raise exception 'management_required' using errcode='42501'; end if;
 return (select jsonb_build_object('historical_changes',count(*) filter(where kind<>'source_deleted'),'source_deletions',count(*) filter(where kind='source_deleted')) from public.clickdesk_event_corrections where detected_at>=now()-interval '14 days');
end $$;
revoke all on function public.get_clickdesk_event_correction_summary() from public,anon;
grant execute on function public.get_clickdesk_event_correction_summary() to authenticated;

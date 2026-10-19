create function public.get_clickdesk_period_attestation(p_start date,p_end date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entry record;
begin
 if auth.uid() is null or not(public.is_management_user() or public.current_user_chat_analyst_id() is not null) then raise exception 'Active chat access required' using errcode='42501';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>92 then raise exception 'Invalid period';end if;
 select c.completeness,c.pending_count,c.verified_at into entry
 from public.clickdesk_final_coverage c where c.source_key like 'period_inventory_%'
 and c.start_date<=p_start and c.end_date>=p_end
 order by c.verified_at desc limit 1;
 return jsonb_build_object('complete',coalesce(entry.completeness='complete' and entry.pending_count=0,false),'verified_at',entry.verified_at);
end $$;
revoke all on function public.get_clickdesk_period_attestation(date,date)from public,anon;
grant execute on function public.get_clickdesk_period_attestation(date,date)to authenticated;

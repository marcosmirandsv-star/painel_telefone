-- REVIEW ONLY. Configure using production server-side credentials, never HML values or chat messages.
-- Definition only: does not create secrets until explicitly invoked after release approval.
create function public.initialize_clickdesk_production_credentials(p_api_key text,p_account_id text)
returns boolean language plpgsql security definer set search_path='' as $function$
begin
 if length(trim(coalesce(p_api_key,'')))<16 or length(trim(coalesce(p_account_id,'')))=0 then raise exception 'Invalid production source configuration';end if;
 if exists(select 1 from vault.secrets where name in('clickdesk_api_key','clickdesk_account_id','clickdesk_cron_token')) then raise exception 'Existing credentials require separate review';end if;
 perform vault.create_secret(trim(p_api_key),'clickdesk_api_key','Production ClickDesk capture');
 perform vault.create_secret(trim(p_account_id),'clickdesk_account_id','Production ClickDesk account');
 perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'clickdesk_cron_token','Production ClickDesk internal worker token');
 return true;
end $function$;
revoke all on function public.initialize_clickdesk_production_credentials(text,text) from public,anon,authenticated;
grant execute on function public.initialize_clickdesk_production_credentials(text,text) to service_role;


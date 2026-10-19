create table public.clickdesk_source_exclusions(ticket_id text primary key,reason text not null check(reason='deleted_in_source'),source_deleted_at timestamptz not null,evidence_hash text not null,verified_at timestamptz not null default now());
alter table public.clickdesk_source_exclusions enable row level security;
revoke all on public.clickdesk_source_exclusions from public,anon,authenticated;
grant select on public.clickdesk_source_exclusions to authenticated;
grant all on public.clickdesk_source_exclusions to service_role;
create policy source_exclusions_management_read on public.clickdesk_source_exclusions for select to authenticated using((select public.is_management_user()));
create function public.record_clickdesk_source_deletions(p_rows jsonb,p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>32 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid deletion evidence';end if;
 with inserted as(
 insert into public.clickdesk_source_exclusions(ticket_id,reason,source_deleted_at,evidence_hash)
 select r.ticket_id,'deleted_in_source',r.deleted_at,p_hash from jsonb_to_recordset(p_rows)as r(ticket_id text,deleted_at timestamptz)
 where r.ticket_id ~ '^[0-9]{1,25}$' and r.deleted_at<=now() and not exists(select 1 from public.clickdesk_final_ticket_ledger l where l.ticket_id=r.ticket_id)
 and (exists(select 1 from public.clickdesk_chat_capture_queue c where c.ticket_id=r.ticket_id)or exists(select 1 from public.clickdesk_chat_attendances c where c.clickdesk_ticket_id=r.ticket_id))
 on conflict(ticket_id)do update set source_deleted_at=excluded.source_deleted_at,evidence_hash=excluded.evidence_hash,verified_at=now()
 returning ticket_id)
 select coalesce(jsonb_agg(ticket_id),'[]'::jsonb)into result from inserted;
 return result;
end $$;
revoke all on function public.record_clickdesk_source_deletions(jsonb,text) from public,anon,authenticated;
grant execute on function public.record_clickdesk_source_deletions(jsonb,text)to service_role;
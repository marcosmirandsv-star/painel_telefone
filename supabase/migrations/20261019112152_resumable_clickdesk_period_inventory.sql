
create table public.clickdesk_period_inventory (
 period_key text primary key check(period_key ~ '^20[0-9]{2}-[0-9]{2}$'),
 start_date date not null,end_date date not null,cutoff_date date not null,
 status text not null default 'pending', pass integer not null default 1,
 next_page integer not null default 1,total_pages integer,total_items integer,
 started_at timestamptz not null default now(),finished_at timestamptz,
 last_incremental_at timestamptz,lease_until timestamptz,error_code text
);
create table public.clickdesk_period_inventory_pages (
 period_key text references public.clickdesk_period_inventory(period_key),pass integer not null,page integer not null,
 page_hash text not null,item_count integer not null,total_items integer not null,
 primary key(period_key,pass,page)
);
create table public.clickdesk_period_inventory_candidates (
 period_key text references public.clickdesk_period_inventory(period_key),ticket_id text not null,
 source_updated_at timestamptz not null,last_seen_pass integer not null,
 primary key(period_key,ticket_id)
);
alter table public.clickdesk_period_inventory enable row level security;
alter table public.clickdesk_period_inventory_pages enable row level security;
alter table public.clickdesk_period_inventory_candidates enable row level security;
revoke all on public.clickdesk_period_inventory,public.clickdesk_period_inventory_pages,public.clickdesk_period_inventory_candidates from anon,authenticated;
grant select on public.clickdesk_period_inventory,public.clickdesk_period_inventory_pages,public.clickdesk_period_inventory_candidates to authenticated;
grant all on public.clickdesk_period_inventory,public.clickdesk_period_inventory_pages,public.clickdesk_period_inventory_candidates to service_role;
create policy management_inventory on public.clickdesk_period_inventory for select to authenticated using((select public.is_management_user()));
create policy management_inventory_pages on public.clickdesk_period_inventory_pages for select to authenticated using((select public.is_management_user()));
create policy management_inventory_candidates on public.clickdesk_period_inventory_candidates for select to authenticated using((select public.is_management_user()));

create function public.save_clickdesk_inventory_page(p_period text,p_pass integer,p_page integer,p_hash text,p_count integer,p_total integer,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.clickdesk_period_inventory;
begin
 select * into r from public.clickdesk_period_inventory where period_key=p_period for update;
 if not found then raise exception 'Inventory not found'; end if;
 insert into public.clickdesk_period_inventory_pages values(p_period,p_pass,p_page,p_hash,p_count,p_total)
 on conflict(period_key,pass,page) do update set page_hash=excluded.page_hash,item_count=excluded.item_count,total_items=excluded.total_items;
 insert into public.clickdesk_period_inventory_candidates(period_key,ticket_id,source_updated_at,last_seen_pass)
 select p_period,x.ticket_id,x.source_updated_at,p_pass from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(period_key,ticket_id) do update set source_updated_at=greatest(clickdesk_period_inventory_candidates.source_updated_at,excluded.source_updated_at),last_seen_pass=excluded.last_seen_pass;
 insert into public.clickdesk_chat_capture_queue(ticket_id,period_start,period_end,discovered_page,status,source_updated_at)
 select x.ticket_id,r.start_date,r.cutoff_date,p_page,'pending',x.source_updated_at
 from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
 on conflict(ticket_id) do update set
 period_start=least(clickdesk_chat_capture_queue.period_start,excluded.period_start),
 period_end=greatest(clickdesk_chat_capture_queue.period_end,excluded.period_end),
 source_updated_at=greatest(clickdesk_chat_capture_queue.source_updated_at,excluded.source_updated_at),
 status=case when excluded.source_updated_at>coalesce(clickdesk_chat_capture_queue.source_updated_at,'-infinity'::timestamptz) then 'pending' else clickdesk_chat_capture_queue.status end;
end $$;
revoke all on function public.save_clickdesk_inventory_page(text,integer,integer,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_clickdesk_inventory_page(text,integer,integer,text,integer,integer,jsonb) to service_role;


create table public.clickdesk_inventory_partitions (
 id uuid primary key default gen_random_uuid(),period_key text not null references public.clickdesk_period_inventory(period_key),
 created_from date not null,created_to date not null,status text not null default 'pending',pass integer not null default 1,
 next_page integer not null default 1,total_pages integer,total_items integer,error_code text,
 unique(period_key,created_from,created_to),check(created_to>=created_from)
);
create table public.clickdesk_inventory_partition_pages (
 partition_id uuid references public.clickdesk_inventory_partitions(id),pass integer not null,page integer not null,
 page_hash text not null,item_count integer not null,total_items integer not null,
 primary key(partition_id,pass,page)
);
alter table public.clickdesk_inventory_partitions enable row level security;
alter table public.clickdesk_inventory_partition_pages enable row level security;
revoke all on public.clickdesk_inventory_partitions,public.clickdesk_inventory_partition_pages from anon,authenticated;
grant select on public.clickdesk_inventory_partitions,public.clickdesk_inventory_partition_pages to authenticated;
grant all on public.clickdesk_inventory_partitions,public.clickdesk_inventory_partition_pages to service_role;
create policy management_inventory_partitions on public.clickdesk_inventory_partitions for select to authenticated using((select public.is_management_user()));
create policy management_inventory_partition_pages on public.clickdesk_inventory_partition_pages for select to authenticated using((select public.is_management_user()));
create function public.save_clickdesk_inventory_partition_page(p_partition uuid,p_pass integer,p_page integer,p_hash text,p_count integer,p_total integer,p_rows jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.clickdesk_period_inventory; part public.clickdesk_inventory_partitions;
begin
 select * into part from public.clickdesk_inventory_partitions where id=p_partition for update;
 select * into r from public.clickdesk_period_inventory where period_key=part.period_key;
 insert into public.clickdesk_inventory_partition_pages values(p_partition,p_pass,p_page,p_hash,p_count,p_total)
 on conflict(partition_id,pass,page) do update set page_hash=excluded.page_hash,item_count=excluded.item_count,total_items=excluded.total_items;
 insert into public.clickdesk_period_inventory_candidates(period_key,ticket_id,source_updated_at,last_seen_pass)
 select part.period_key,x.ticket_id,x.source_updated_at,p_pass from jsonb_to_recordset(p_rows) as x(ticket_id text,source_updated_at timestamptz)
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
revoke all on function public.save_clickdesk_inventory_partition_page(uuid,integer,integer,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_clickdesk_inventory_partition_page(uuid,integer,integer,text,integer,integer,jsonb) to service_role;
update public.clickdesk_period_inventory set status='running',pass=1,next_page=1,total_pages=null,total_items=null,lease_until=null,error_code=null where period_key='2026-10';

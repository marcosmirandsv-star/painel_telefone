alter table public.clickdesk_inventory_partitions
 add column source_max_updated_at timestamptz,
 add column preflight_hash text,
 add column preflight_verified_at timestamptz,
 add column excluded_before_period boolean not null default false,
 add column preflight_reported_total integer;
comment on column public.clickdesk_inventory_partitions.excluded_before_period is 'Range has no period candidate: a created-range query sorted by updated_at descending proved its maximum update precedes the period. The immutable scan watermark catches later changes. total_items counts enumerated rows only, never the capped source account total.';
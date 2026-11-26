-- Applied in production on26Nov; no vote row or original rating/review rewrite.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.clickdesk_official_period_votes drop constraint clickdesk_official_period_votes_pkey;
alter table public.clickdesk_official_period_votes add primary key(period_start,period_end,ticket_id,source_owner_key,rated_at);
commit;

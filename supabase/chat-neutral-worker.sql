begin;
alter table public.clickdesk_neutral_reviews add column if not exists conversation_version timestamptz;
create table public.clickdesk_neutral_review_attempts (
 id bigint generated always as identity primary key,ticket_id text not null references public.clickdesk_event_ratings(ticket_id),
 source_hash text not null,transcript_hash text,analysis jsonb,model text,error_code text,
 created_at timestamptz not null default now()
);
alter table public.clickdesk_neutral_review_attempts enable row level security;
revoke all on public.clickdesk_neutral_review_attempts from public,anon,authenticated;
grant all on public.clickdesk_neutral_review_attempts to service_role;
grant usage,select on sequence public.clickdesk_neutral_review_attempts_id_seq to service_role;
grant select on public.clickdesk_neutral_review_attempts to authenticated;
create policy neutral_attempt_scope on public.clickdesk_neutral_review_attempts for select to authenticated using((select public.is_management_user()) or exists(select 1 from public.clickdesk_event_ratings r where r.ticket_id=clickdesk_neutral_review_attempts.ticket_id and r.analyst_id=(select public.current_user_chat_analyst_id())));
create function public.claim_clickdesk_neutral_reviews(p_limit integer default 2)
returns setof public.clickdesk_neutral_reviews language plpgsql security definer set search_path='' as $$
begin
 update public.clickdesk_neutral_reviews n set status='pending',attempts=0,exclusion_eligible=false,next_attempt_at=now()
 from public.clickdesk_event_capture_queue q where q.ticket_id=n.ticket_id and n.status in ('verified','needs_review') and n.conversation_version<q.source_version;
 return query with chosen as(select n.ticket_id from public.clickdesk_neutral_reviews n
 where ((n.status in ('pending','technical_failure') and n.next_attempt_at<=now()) or (n.status='processing' and n.lease_until<now()))
 order by n.attempts,n.next_attempt_at limit least(greatest(p_limit,1),4) for update skip locked)
 update public.clickdesk_neutral_reviews n set status='processing',attempts=n.attempts+1,
 lease_token=gen_random_uuid(),lease_until=now()+interval '4 minutes' from chosen c where n.ticket_id=c.ticket_id returning n.*;
end $$;
revoke all on function public.claim_clickdesk_neutral_reviews(integer) from public,anon,authenticated;
grant execute on function public.claim_clickdesk_neutral_reviews(integer) to service_role;
create function public.finish_clickdesk_neutral_review(p_ticket text,p_lease uuid,p_hash text,p_conversation_version timestamptz,p_analysis jsonb,p_model text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n public.clickdesk_neutral_reviews;r public.clickdesk_event_ratings; eligible boolean;
begin
 select * into n from public.clickdesk_neutral_reviews where ticket_id=p_ticket for update;
 if not found or n.lease_token is distinct from p_lease or n.status<>'processing' then return false; end if;
 select * into r from public.clickdesk_event_ratings where ticket_id=p_ticket;
 if r.source_hash is distinct from n.source_hash then return false; end if;
 eligible:=coalesce((p_analysis->>'exclusion_eligible')::boolean,false)
  and p_analysis->>'cause' in ('system','other_external') and p_analysis->>'confidence'='high'
  and p_analysis->>'human_contribution'='false' and p_analysis->>'two_pass_agreement'='true'
  and r.original_label='Neutro' and r.sentiment='negative' and length(p_hash)=64;
 insert into public.clickdesk_neutral_review_attempts(ticket_id,source_hash,transcript_hash,analysis,model)
 values(p_ticket,n.source_hash,p_hash,p_analysis,p_model);
 update public.clickdesk_neutral_reviews set cause=case when p_analysis->>'cause' in ('human','system','other_external','mixed','inconclusive') then p_analysis->>'cause' else 'inconclusive' end,
 status=case when p_analysis->>'cause'='inconclusive' then 'needs_review' else 'verified' end,
 transcript_hash=p_hash,analysis=p_analysis,model=p_model,exclusion_eligible=eligible,
 conversation_version=p_conversation_version,lease_token=null,lease_until=null,error_code=null,reviewed_at=now()
 where ticket_id=p_ticket;
 return true;
end $$;
revoke all on function public.finish_clickdesk_neutral_review(text,uuid,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_clickdesk_neutral_review(text,uuid,text,timestamptz,jsonb,text) to service_role;
commit;

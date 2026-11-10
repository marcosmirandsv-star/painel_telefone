-- Execute ONLY after explicit approval and application of the additive migration.
-- Test fixtures and all changes, including source reconciliation, are rolled back.
begin;
select set_config('cx360.fixture.manager',(select id::text from public.profiles where role::text='master' limit 1),true);
select set_config('cx360.fixture.analyst',(select id::text from public.profiles where role::text='analista' limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('cx360.fixture.manager'),true);
set local role service_role;
do $$
declare team uuid; day date:=((now() at time zone 'America/Sao_Paulo')::date-1); sid text:='test-'||gen_random_uuid()::text; item jsonb; claimed public.cx360_ratings; denied boolean; cid uuid;
begin
 select team_id into team from public.cx360_sources order by source_name limit 1;
 if team is null or nullif(current_setting('cx360.fixture.manager'),'') is null then raise exception 'Missing fixture prerequisites';end if;
 item:=jsonb_build_object('id',sid,'ticket_id','999999999999','number','999999999999','team_id',team,'source_team','Suporte - Fiscal','subject','TESTE TRANSACIONAL, NÃO PERSISTIR','rated_at',day::text||'T12:00:00Z','rated_day',day,'label','Ruim','owner_name','Teste sintético','eligible',true,'comment','','source_hash','fixture-v1');
 perform public.cx360_ingest(day,day,jsonb_build_array(item),1,null);
 select * into claimed from public.cx360_claim(day,day,team,1) where id=sid;
 if claimed.id is null or claimed.lease_token is null or claimed.attempts<>1 then raise exception 'Claim failed';end if;
 if exists(select 1 from public.cx360_claim(day,day,team,1) where id=sid) then raise exception 'Duplicate concurrent claim';end if;
 update public.cx360_ratings set status='analyzed',analysis='{}',analysis_hash='fixture-analysis-v1',lease_token=null,lease_until=null where id=sid;
 perform public.cx360_ingest(day,day,jsonb_build_array(item),1,null);
 if not exists(select 1 from public.cx360_ratings where id=sid and status='analyzed')then raise exception 'Unchanged source invalidated cache';end if;
 item:=jsonb_set(item,'{source_hash}','"fixture-v2"');
 perform public.cx360_ingest(day,day,jsonb_build_array(item),1,null);
 if not exists(select 1 from public.cx360_ratings where id=sid and status='pending' and analysis is null and analysis_hash is null and attempts=0)then raise exception 'Source change did not invalidate analysis';end if;
 denied:=false;
 begin perform public.cx360_ingest(day+1,day+1,'[]',0,null);exception when others then denied:=true;end;
 if not denied then raise exception 'Today exposed despite D-1';end if;
 update public.cx360_ratings set status='analyzed',analysis='{}',analysis_hash='fixture-analysis-v2' where id=sid;
 insert into public.cx360_reviews(rating_id,analysis_hash,decision,notes,reviewed_by)values(sid,'fixture-analysis-v2','confirmed','Validação sintética de teste transacional',current_setting('cx360.fixture.manager')::uuid);
 perform set_config('cx360.fixture.id',sid,true);
end $$;
reset role;
set local role authenticated;
do $$ declare sid text:=current_setting('cx360.fixture.id');r public.cx360_ratings;cid uuid;denied boolean:=false;
begin
 select * into r from public.cx360_ratings where id=sid;
 if r.id is null then raise exception 'Management read denied';end if;
 insert into public.cx360_cases(ticket_source,ticket_id,team_id,title,observation,evidence,owner_id,diagnostic_id,diagnostic_hash)
 values('clickdesk',r.ticket_id,r.team_id,'TESTE DIAGNÓSTICO — NÃO PERSISTIR','Observação sintética do teste','Referência verificável sintética do teste',auth.uid(),r.id,r.analysis_hash) returning id into cid;
 begin update public.cx360_cases set diagnostic_hash='rewritten' where id=cid;exception when others then denied:=true;end;
 if not denied then raise exception 'Diagnostic reference could be rewritten';end if;
 if not exists(select 1 from public.cx360_events where case_id=cid and actor_id=auth.uid())then raise exception 'Audit missing';end if;
 if has_function_privilege('authenticated','public.cx360_ingest(date,date,jsonb,integer,uuid)','EXECUTE') or has_function_privilege('anon','public.cx360_claim(date,date,uuid,integer)','EXECUTE')then raise exception 'Worker function exposed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('cx360.fixture.analyst'),true);
set local role authenticated;
do $$begin
 if nullif(current_setting('cx360.fixture.analyst'),'') is null then raise exception 'Missing analyst prerequisite';end if;
 if exists(select 1 from public.cx360_ratings where id=current_setting('cx360.fixture.id')) or exists(select 1 from public.cx360_reviews where rating_id=current_setting('cx360.fixture.id'))then raise exception 'Analyst accessed management diagnosis';end if;
end $$;
reset role;
select 'PASS — D-1, source reconciliation, claim exclusion, cache invalidation, immutable references, audit, management access and analyst denial. All fixture writes rolled back.' result;
rollback;

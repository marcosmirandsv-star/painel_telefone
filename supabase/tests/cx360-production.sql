-- Nonpersistent production smoke test. All fixture writes are rolled back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role::text='master' limit 1),true);
select set_config('cx360.test.team',(select id::text from public.chat_teams limit 1),true);
select set_config('cx360.test.ticket',gen_random_uuid()::text,true);
set local role authenticated;
do $$ declare cid uuid; denied boolean; n integer;
begin
  if auth.uid() is null or current_setting('cx360.test.team',true) is null then raise exception 'Missing test prerequisites'; end if;
  insert into public.cx360_cases(ticket_source,ticket_id,team_id,title,observation,evidence,owner_id)
  values('clickdesk',current_setting('cx360.test.ticket'),current_setting('cx360.test.team')::uuid,'TESTE TRANSACIONAL — NÃO PERSISTIR','Verificação técnica do fluxo de gestão','Evidência sintética de teste transacional',auth.uid()) returning id into cid;
  denied:=false;
  begin update public.cx360_cases set status='concluido',outcome='Tentativa de salto' where id=cid; exception when others then denied:=true; end;
  if not denied then raise exception 'Workflow skip allowed'; end if;
  update public.cx360_cases set status='em_investigacao' where id=cid;
  update public.cx360_cases set status='aguardando_validacao' where id=cid;
  denied:=false;
  begin update public.cx360_cases set status='acao_definida',action='Conferir fluxo',review_date=current_date+7,decision_notes='Evidência revisada' where id=cid; exception when others then denied:=true; end;
  if not denied then raise exception 'Implicit approval allowed'; end if;
  update public.cx360_cases set status='acao_definida',action='Conferir fluxo',review_date=current_date+7,decision_notes='Evidência revisada',approval_requested=true where id=cid;
  if not exists(select 1 from public.cx360_cases where id=cid and approved_by=auth.uid() and approved_at is not null and not approval_requested) then raise exception 'Approval provenance absent'; end if;
  denied:=false;
  begin update public.cx360_cases set action='Alteração não aprovada' where id=cid; exception when others then denied:=true; end;
  if not denied then raise exception 'Approved plan could be changed'; end if;
  update public.cx360_cases set status='em_acompanhamento' where id=cid;
  denied:=false;
  begin update public.cx360_cases set status='concluido' where id=cid; exception when others then denied:=true; end;
  if not denied then raise exception 'Closure without outcome allowed'; end if;
  update public.cx360_cases set status='concluido',outcome='Teste encerrado; transação será revertida' where id=cid;
  select count(*) into n from public.cx360_events where case_id=cid;
  if n<>6 then raise exception 'Expected 6 audit events; got %',n; end if;
  if not exists(select 1 from public.cx360_cases where id=cid and version=6) then raise exception 'Version mismatch'; end if;
  denied:=false;
  begin insert into public.cx360_events(case_id,actor_id,after_state) values(cid,auth.uid(),'{}'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Audit forgery allowed'; end if;
  denied:=false;
  begin update public.cx360_cases set outcome='Reescrita de caso encerrado' where id=cid; exception when others then denied:=true; end;
  if not denied then raise exception 'Completed case could be rewritten'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role::text='analista' limit 1),true);
set local role authenticated;
do $$ declare n integer; denied boolean:=false;
begin
  if auth.uid() is null then raise exception 'Missing analyst test prerequisite'; end if;
  select count(*) into n from public.cx360_cases; if n<>0 then raise exception 'Analyst read management cases'; end if;
  select count(*) into n from public.cx360_events; if n<>0 then raise exception 'Analyst read audit'; end if;
  begin insert into public.cx360_cases(ticket_source,ticket_id,team_id,title,observation,evidence,owner_id)
  values('clickdesk',gen_random_uuid()::text,current_setting('cx360.test.team')::uuid,'Tentativa não autorizada','Observação técnica de teste','Evidência técnica de teste',auth.uid()); exception when others then denied:=true; end;
  if not denied then raise exception 'Analyst inserted management case'; end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.cx360_cases','SELECT') or has_table_privilege('anon','public.cx360_cases','INSERT') or has_table_privilege('anon','public.cx360_events','SELECT') then raise exception 'Anonymous privileges'; end if;
  if has_table_privilege('authenticated','public.cx360_cases','DELETE') or has_table_privilege('authenticated','public.cx360_events','UPDATE') or has_table_privilege('authenticated','public.cx360_events','DELETE') then raise exception 'Excess privileges'; end if;
  if has_function_privilege('authenticated','cx360_private.audit_case()','EXECUTE') then raise exception 'Audit publicly executable'; end if;
end $$;
select 'PASS — explicit approval, lifecycle, immutable evidence, append-only audit, concurrency versions, analyst and anonymous denial; test writes rolled back' result;
rollback;

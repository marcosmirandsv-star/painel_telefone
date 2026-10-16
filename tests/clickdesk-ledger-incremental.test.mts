import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finalHumanTicket } from '../src/lib/clickdesk-final-owner.ts'

const source = (p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const worker = source('supabase/functions/clickdesk-ledger-incremental/index.ts')

test('edge ledger usa o mesmo algoritmo de autoria humana final da aplicação', () => {
  const canonical = source('src/lib/clickdesk-final-owner.ts').trim()
  assert.ok(worker.includes(canonical))
  assert.match(worker,/readTicketHistory\(/)
  assert.match(worker,/finalHumanTicket\(/)
  assert.match(worker,/\.upsert\(rows,\{onConflict:'ticket_id'\}\)/)
  assert.match(worker,/\.from\('clickdesk_final_ticket_pending'\)/)
  assert.match(worker,/const dry=body\.dry_run!==false/)
  assert.match(worker,/body\.commit_verified!==true/)
  assert.match(worker,/\.hostname!==HOMO/)
  assert.match(worker,/get_clickdesk_cron_credentials/)
  assert.doesNotMatch(worker,/\.from\('profiles'\).*?\.insert\(/)
  assert.doesNotMatch(worker,/create_user|deleteUser|removeUser/)
})

test('último humano e avaliação seguem o mesmo crédito; aprendizes não recebem', () => {
  const people = [
    {id:'1',name:'Vanessa Silva',team_id:'notas'},
    {id:'2',name:'Thiago Reis',team_id:'notas'},
    {id:'3',name:'Ana Júlia',team_id:'notas'},
  ]
  const msg = (id:string, name:string, hour:number)=>({
    id,created_at:`2026-10-16T${String(hour).padStart(2,'0')}:00:00Z`,
    public:true,author_type:'agent',author:{name},
  })
  const ticket = {satisfaction:{sentiment:'negative',rated_at:'2026-10-16T16:00:00Z'}}
  const valid=finalHumanTicket('t1',[msg('1','Vanessa Silva',12),msg('2','Thiago Reis',13)],
    [],ticket,people,true)
  assert.equal(valid.confirmed,true)
  assert.equal(valid.analyst_id,'2')
  assert.equal(valid.satisfaction_label,'negative')
  assert.equal(valid.message_id,'2')
  const apprentice=finalHumanTicket('t1',[msg('1','Vanessa Silva',12),msg('3','Ana Júlia',13)],
    [],ticket,people,true)
  assert.equal(apprentice.confirmed,false)
  assert.equal(apprentice.reason,'final_author_apprentice')
  const unrated=finalHumanTicket('t2',[msg('2','Thiago Reis',13)],[],{},people,true)
  assert.equal(unrated.confirmed,true)
  assert.equal(unrated.satisfaction_label,null)
})

test('Painel gestor e acesso individual filtram o mesmo ledger por analyst_id', () => {
  const metrics=source('src/app/api/clickdesk/metrics/route.ts')
  const server=source('src/lib/clickdesk-ledger-server.ts')
  assert.match(metrics,/const filters = access\.isManagement/)
  assert.match(metrics,/analystId: access\.chatAnalystId/)
  assert.match(metrics,/loadRows\(access\.admin, filters\)/)
  assert.match(server,/\.eq\('analyst_id', filters\.analystId\)/)
  assert.match(metrics,/const rows: DailyMetricRow\[\] = tickets\.map/)
  assert.match(metrics,/positive_reviews: Number\(ticket\.satisfaction_label === 'positive'\)/)
  assert.match(metrics,/negative_reviews: Number\(ticket\.satisfaction_label === 'negative'\)/)
})

test('Análise 360 valida tickets com a mesma titularidade final e exclui pendentes',()=>{
  const db=source('supabase/functions/clickdesk-360-db/index.ts')
  assert.match(db,/\.from\('clickdesk_final_ticket_ledger'\)/)
  assert.match(db,/\.from\('clickdesk_final_ticket_pending'\)/)
  assert.match(db,/pendingIds\.has\(String\(row\.clickdesk_ticket_id\)\)/)
  assert.match(db,/Final authorship unresolved/)
  assert.doesNotMatch(db,/\.from\('clickdesk_chat_attendances'\)/)
  assert.match(db,/vvtorcvchnqhcredhorv\.supabase\.co/)
})

test('amostra individual de avaliações também lê o ledger final e respeita isolamento',()=>{
  const sample=source('src/app/api/clickdesk/evaluated-sample/route.ts')
  assert.match(sample,/readFinalLedger\(access\.admin, \{ start, end, analystId \}\)/)
  assert.match(sample,/requestedAnalystId !== access\.chatAnalystId/)
  assert.doesNotMatch(sample,/clickdesk_chat_attendances/)
  assert.match(sample,/source: 'clickdesk_final_ticket_ledger'/)
})

test('worker inclui o unwrapping exigido pelo leitor histórico',()=>{
  assert.match(worker,/const unwrap = \(payload: unknown\) =>/)
  assert.match(worker,/const ticket = unwrap\(await get\(/)
})

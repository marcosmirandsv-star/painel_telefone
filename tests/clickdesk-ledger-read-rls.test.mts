import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('API do painel usa somente sessão validada para leitura de ledger e status',()=>{
  const metrics=read('src/app/api/clickdesk/metrics/route.ts')
  const history=read('src/app/api/clickdesk/history/route.ts')
  const tickets=read('src/app/api/clickdesk/tickets/route.ts')
  const health=read('src/app/api/clickdesk/health/route.ts')
  for(const [name,source] of Object.entries({metrics,history,tickets,health})){
    assert.match(source,/authorizeClickDeskSessionClient\(request\)/,name)
    assert.doesNotMatch(source,/homologationReadAdmin\(\)/,name)
    assert.match(source,/access\.admin/,name)
  }
  assert.match(metrics,/loadRows\(access\.admin, filters\)/)
  assert.match(metrics,/async function loadRows\(\s*admin:/)
  assert.match(history,/readFinalLedger\(admin, \{/)
  assert.match(tickets,/const admin = access\.admin/)
  assert.match(health,/const admin = access\.admin/)
})

test('políticas preservam leitura por titular e nunca liberam dados de terceiros',()=>{
  const sql=read('supabase/clickdesk-final-ledger-read-rls-20261014.sql')
  assert.match(sql,/grant select on public\.clickdesk_final_ticket_ledger to authenticated/)
  assert.match(sql,/analyst_id = \(select public\.current_user_chat_analyst_id\(\)\)/)
  assert.match(sql,/ledger\.analyst_id = \(select public\.current_user_chat_analyst_id\(\)\)/)
  assert.match(sql,/clickdesk_final_coverage_management_select/)
  assert.match(sql,/public\.is_management_user\(\)/)
  assert.match(sql,/revoke insert, update, delete, truncate, references, trigger/)
  assert.doesNotMatch(sql,/grant all|grant .* to anon|for select to anon|using\s*\(\s*true\s*\)/i)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve360BatchWindow } from '../src/lib/clickdesk-360-window.ts'

const source = (path: string) => readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('janela padrão da automação inclui todo o outubro pendente até hoje',()=>{
  const result=resolve360BatchWindow({limit:8},'2026-10-17')
  assert.deepEqual(result,{
    start:'2026-10-01',end:'2026-10-17',limit:8,
    period_source:'backlog_october_to_today',
  })
  const route=source('src/app/api/clickdesk/operation-360/auto-process/route.ts')
  assert.match(route,/resolve360BatchWindow\(body, today\)/)
  assert.match(route,/period_source: periodSource/)
  assert.match(route,/action: 'queue'/)
})

test('janela explícita, datas inválidas e limites são validados',()=>{
  assert.deepEqual(resolve360BatchWindow({start:'2026-10-14',end:'2026-10-15',limit:100},'2026-10-17'),{
    start:'2026-10-14',end:'2026-10-15',limit:8,
    period_source:'explicit',
  })
  assert.equal(resolve360BatchWindow({start:'2026-10-14',limit:0},'2026-10-17').limit,1)
  assert.equal(resolve360BatchWindow({start:'2026-10-14'},'2026-10-17').end,'2026-10-17')
  for(const input of [
    {start:'2026-09-30'},{start:'2026-10-18'},{start:'2026-10-15',end:'2026-10-14'},
    {start:'2026-10-14',end:'2026-10-20'},{start:'2026-02-30'},{end:'bad'},
  ]) assert.throws(()=>resolve360BatchWindow(input,'2026-10-17'))
  assert.throws(()=>resolve360BatchWindow({},'invalid-date'))
})

test('qualitativo é processado internamente com autenticação e sem segundo acesso SSO',()=>{
  const route=source('src/app/api/clickdesk/operation-360/auto-process/route.ts')
  const qualitative=source('src/app/api/clickdesk/qualitative/route.ts')
  assert.match(route,/authorizeClickDeskAutomation\(request\)/)
  assert.match(route,/import \{ POST as processQualitativeTicket \} from '\.\.\/\.\.\/qualitative\/route'/)
  assert.match(route,/await processQualitativeTicket\(new Request\(/)
  assert.match(route,/'X-Central-Automation': 'clickdesk-sync'/)
  assert.doesNotMatch(route,/await fetch\(\x60\$\{baseUrl\}\/api\/clickdesk\/qualitative/)
  assert.match(qualitative,/authorizeClickDeskAutomation\(request\)/)
  assert.match(qualitative,/clickdesk_final_ticket_pending/)
})

test('acesso servidor-servidor da Vercel usa header persistente protegido',()=>{
  const dispatcher=source('supabase/functions/clickdesk-360-dispatch/index.ts')
  assert.match(dispatcher,/get_homologation_360_dispatch_config/)
  assert.match(dispatcher,/x-vercel-protection-bypass/)
  assert.match(dispatcher,/X-Central-Automation/)
  assert.match(dispatcher,/Vercel automation protection bypass not authorized/)
  assert.doesNotMatch(dispatcher,/SHARE_COOKIE_NAME/)
  assert.doesNotMatch(dispatcher,/\/_vercel_share=\$\{/)
  assert.doesNotMatch(dispatcher,/get\('set-cookie'\)/)
  assert.match(dispatcher,/\[301, 302, 303, 307, 308, 401, 403\]/)
  assert.match(dispatcher,/p_token: token/)
})

test('segurança: sem período fora do backlog, sem alterar produção ou telefone',()=>{
  const route=source('src/app/api/clickdesk/operation-360/auto-process/route.ts')
  const dispatcher=source('supabase/functions/clickdesk-360-dispatch/index.ts')
  assert.match(route,/environment !== 'homologacao'/)
  assert.match(route,/authorizeClickDeskAutomation/)
  assert.match(dispatcher,/get_homologation_360_dispatch_config/)
  assert.doesNotMatch(route+dispatcher,/weekly_team_metrics|weekly_individual_metrics|55DBX/)
})

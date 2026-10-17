import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('automação 360 retoma outubro inteiro, e nunca só o próprio dia',()=>{
  const route=source('src/app/api/clickdesk/operation-360/auto-process/route.ts')
  assert.match(route,/const oldestBacklogDate = '2026-10-01'/)
  assert.match(route,/typeof body\.start === 'string' && body\.start\.trim\(\)[\s\S]*?: oldestBacklogDate/)
  assert.match(route,/typeof body\.end === 'string' && body\.end\.trim\(\)[\s\S]*?: today/)
  assert.match(route,/start > end \|\| end > today \|\| start < '2026-10-01'/)
  assert.match(route,/period_source: body\.start \|\| body\.end \? 'explicit' : 'backlog_october_to_today'/)
  assert.match(route,/limit = Math\.max\(1, Math\.min\(requestedLimit, 8\)\)/)
  assert.match(route,/action: 'queue'/)
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

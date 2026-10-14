import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('homologação e produção usam configuração única para credenciais de servidor', () => {
  const integration = source('src/lib/integration-server.ts')
  const finalOwner = source('src/lib/clickdesk-final-owner-server.ts')
  assert.match(integration, /export function adminClient\(\)[\s\S]*?getServerSupabaseConfig\(\)/)
  assert.match(integration, /authorizeClickDeskSessionClient\([\s\S]*?getServerSupabaseConfig\(\)/)
  assert.match(finalOwner, /export function homologationReadAdmin\(\)[\s\S]*?config\.environment !== 'homologacao'/)
  assert.match(finalOwner, /vvtorcvchnqhcredhorv\.supabase\.co/)
})

test('consultas do painel usam o ledger e nunca refazem auditoria REST', () => {
  const metrics = source('src/app/api/clickdesk/metrics/route.ts')
  const history = source('src/app/api/clickdesk/history/route.ts')
  const tickets = source('src/app/api/clickdesk/tickets/route.ts')
  const ledger = source('src/lib/clickdesk-ledger-server.ts')
  for (const route of [metrics, history, tickets]) {
    assert.match(route, /readFinalLedger/)
    assert.doesNotMatch(route, /loadFinalSnapshot\(/)
    assert.match(route, /authorizeClickDeskSessionClient\(request\)/)
  }
  assert.match(ledger, /import 'server-only'/)
  assert.match(ledger, /clickdesk_final_ticket_ledger/)
  assert.match(ledger, /filters\.analystId/)
  assert.match(ledger, /filters\.teamId/)
  assert.match(metrics, /coverageComplete \? 'complete' : 'audit_sample_only'/)
  assert.match(metrics, /selfPodiumContext = null/)
  assert.match(metrics, /console\.info\('clickdesk_metrics'/)
})

test('diagnóstico fica restrito a gestores, sem reconciliação cara', () => {
  const health = source('src/app/api/clickdesk/health/route.ts')
  assert.match(health, /if \(!access\.isManagement\) throw new ApiError\(403/)
  assert.match(health, /const access = await authorizeClickDeskSessionClient\(request\)/)
  assert.doesNotMatch(health, /loadFinalSnapshot|CLICKDESK_API_KEY|CLICKDESK_ACCOUNT_ID/)
})

test('gestão mostra falha, carregamento e estado inconclusivo sem metas falsamente saudáveis', () => {
  const page = source('src/app/page.tsx')
  assert.match(page, /const \[clickDeskMetricsLoading, setClickDeskMetricsLoading\]/)
  assert.match(page, /setClickDeskMetricsLoading\(true\)/)
  assert.match(page, /Sessão indisponível\. Entre novamente no painel/)
  assert.match(page, /Não foi possível consultar a base ClickDesk/)
  assert.match(page, /Não é possível avaliar metas, prioridades ou avaliações negativas/)
  assert.match(page, /chat2CoveragePartial \? '—' : chat2ManagementRows\.length \? chat2ManagementHealthy\.length : '—'/)
  assert.match(page, /AMOSTRA PARCIAL AUDITADA/)
  assert.match(page, /Não há sinais de prioridade entre os tickets comprovados desta amostra/)
  assert.match(page, /Tentar novamente/)
})

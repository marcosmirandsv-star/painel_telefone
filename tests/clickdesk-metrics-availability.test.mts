import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

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

test('sync interpreta listas paginadas diretas e aninhadas sem supor que data é sempre array', () => {
  const edge = source('supabase/functions/clickdesk-d1-sync/index.ts')
  const start = edge.indexOf('function extractCollection(')
  const end = edge.indexOf('\nfunction findFirstByKeyPattern(', start)
  assert.ok(start >= 0 && end > start)
  const compiled = ts.transpileModule(edge.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const extract = runInNewContext(compiled + '\nextractCollection', {}) as (input: unknown) => unknown[]
  const ticket = { id: 'ticket-1' }
  for (const payload of [
    [ticket],
    { data: [ticket] },
    { data: { data: [ticket], total: 1 } },
    { data: { items: [ticket] } },
    { results: [ticket] },
    { records: [ticket] },
  ]) {
    assert.equal(JSON.stringify(extract(payload)), JSON.stringify([ticket]))
  }
  assert.equal(extract({ data: { unexpected: true } }).length, 0)
  assert.equal(extract(null).length, 0)
})

test('sync não interpreta tabela legada vazia como ausência de atendimento humano', () => {
  const edge = source('supabase/functions/clickdesk-d1-sync/index.ts')
  const snapshot = edge.slice(
    edge.indexOf('async function collectReportSnapshotRows('),
    edge.indexOf('async function fetchRecentHumanPages('),
  )
  assert.match(snapshot, /let humanAnswered: number \| null = null/)
  assert.match(snapshot, /from\('clickdesk_final_coverage'\)/)
  assert.match(snapshot, /coverage\.pending_count === 0/)
  assert.match(snapshot, /coverage\.candidate_count === coverage\.confirmed_count/)
  assert.match(snapshot, /from\('clickdesk_final_ticket_ledger'\)/)
  assert.match(snapshot, /human_answered_status: humanAnsweredStatus/)
  assert.doesNotMatch(snapshot, /from\('clickdesk_chat_attendances'\)/)
  assert.match(edge, /first_page_shape:/)
  assert.match(edge, /nested_data_array:/)
  assert.doesNotMatch(edge, /console\.log\(.*(?:apiKey|accountId|payload)/)
})

test('réguas de gestão e individual não inferem zero onde não há dia no ledger', () => {
  const page = source('src/app/page.tsx')
  assert.match(page, /const covered = Boolean\(persistedDay\)/)
  assert.equal((page.match(/const covered = Boolean\(persistedDay\)/g) ?? []).length, 2)
  assert.doesNotMatch(page, /const covered = chat2DailyCoverageStart \? date >= chat2DailyCoverageStart/)
  assert.doesNotMatch(page, /const covered = chat2OperationDailyCoverageStart \? date >= chat2OperationDailyCoverageStart/)
  assert.match(page, /item\.date === chat2DailyDateFilter && item\.covered/)
  assert.match(page, /'em conferência'/)
  assert.match(page, /Dias ainda não conciliados aparecem como em conferência/)
})

test('gestor e analista recebem atualizações automáticas durante recuperação sem polling excessivo',()=>{
  const page=source('src/app/page.tsx')
  assert.match(page,/void loadOwnChatData\(\)[\s\S]*?const refreshTimer = window\.setInterval\([\s\S]*?void loadOwnChatData\(\)[\s\S]*?5 \* 60 \* 1000/)
  assert.match(page,/void loadClickDeskPersistedMetricsOnly\([\s\S]*?selectedTeamId,[\s\S]*?5 \* 60 \* 1000/)
})

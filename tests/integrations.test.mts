import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { calculateAverageCsat, calculateChatAverage, phoneSummary, chatSummary } from '../src/lib/indicators.ts'
import { ApiError, bearer, findConsumer, parseQuery, authorizeManager, authorizeKeyAdmin } from '../src/lib/integration-server.ts'
import { currentIndicators, officialIndicators } from '../src/lib/integration-data.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

function database(tables: Record<string, Record<string, unknown>[]>) {
  return { from(table: string) {
    let start = 0, end = 499
    let records = [...(tables[table] ?? [])]
    const builder = {
      select() { return builder }, order() { return builder },
      range(a: number, b: number) { start = a; end = b; return builder },
      eq(key: string, value: unknown) { records = records.filter(row => row[key] === value); return builder },
      lte(key: string, value: string) { records = records.filter(row => String(row[key]) <= value); return builder },
      gte(key: string, value: string) { records = records.filter(row => String(row[key]) >= value); return builder },
      maybeSingle() { return Promise.resolve({ data: records[0] ?? null, error: null }) },
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: records.slice(start, end + 1), error: null }).then(resolve) },
    }
    return builder
  } } as unknown as SupabaseClient
}

test('sessões longas do Supabase passam pela leitura do cabeçalho; credenciais externas continuam limitadas', () => {
  const token = `eyJ${'a'.repeat(1200)}.payload.signature`
  const request = new Request('https://example.test', { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(bearer(request, 'session'), token)
  assert.throws(() => bearer(request), ApiError)
  for (const value of ['', 'Basic abc', 'Bearer short', `Bearer ${'a'.repeat(8193)}`, 'Bearer two tokens longer-than-twenty']) {
    assert.throws(() => bearer(new Request('https://example.test', { headers: { Authorization: value } }), 'session'), ApiError)
  }
})

test('gestão valida sessão longa no Supabase e mantém verificação do perfil', async (t) => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  t.after(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
  })
  const token = `eyJ${'a'.repeat(1200)}.payload.signature`
  let role = 'master'
  let valid = true
  let checkedSession = false
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/auth/v1/user')) {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${token}`)
      checkedSession = true
      return valid ? Response.json({ id: 'user-test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' }) : Response.json({ message: 'Invalid token' }, { status: 401 })
    }
    assert.ok(url.includes('/rest/v1/profiles'))
    return Response.json({ role })
  })
  const request = new Request('https://example.test', { headers: { Authorization: `Bearer ${token}` } })
  assert.equal((await authorizeManager(request)).userId, 'user-test')
  assert.equal((await authorizeKeyAdmin(request)).userId, 'user-test')
  assert.ok(checkedSession)
  role = 'coordenadora'
  assert.equal((await authorizeManager(request)).userId, 'user-test')
  await assert.rejects(authorizeKeyAdmin(request), (e: unknown) => e instanceof ApiError && e.status === 403)
  role = 'analista'
  await assert.rejects(authorizeManager(request), (e: unknown) => e instanceof ApiError && e.status === 403)
  valid = false
  await assert.rejects(authorizeManager(request), (e: unknown) => e instanceof ApiError && e.status === 401)
})

test('consulta pagina mais de 1.000 registros e inclui semanas sobrepostas', async () => {
  const records = Array.from({ length: 1001 }, (_, id) => ({ id, week_start: '2026-07-27', week_end: '2026-08-02', csat: 90, total_reviews: 1, total_tickets: 2 }))
  const admin = database({ weekly_individual_metrics: [...records, { ...records[0], id: 2000, week_start: '2026-09-01', week_end: '2026-09-07' }] })
  const period = parseQuery(new Request('https://example.test/?mes=2026-08&canal=telefone'))
  const result = await currentIndicators(admin, period, true)
  assert.equal((result.indicadores as ReturnType<typeof phoneSummary>).atendimentos, 2002)
  assert.equal((result.indicadores as ReturnType<typeof phoneSummary>).csat_n1, 90)
  assert.equal(result.status, 'parcial')
})

test('chat respeita exclusões e não retorna identificadores pessoais', async () => {
  const base = { team_id: 'team', year: 2026, month_number: 8, csat: 100, review_percentage: 25, sending_percentage: 75, total_tickets: 100, valid_tickets: 100, reviews: 25, positive_reviews: 25, negative_reviews: 0, inactive_tickets: 0 }
  const admin = database({ chat_monthly_metrics: [{ ...base, id: '1', analyst_id: 'included' }, { ...base, id: '2', analyst_id: 'excluded', csat: 0 }], chat_podium_exclusions: [{ id: 'e', analyst_id: 'excluded', year: 2026, month_number: 8 }] })
  const result = await currentIndicators(admin, parseQuery(new Request('https://example.test/?mes=2026-08&canal=chat')))
  const indicators = result.indicadores as ReturnType<typeof chatSummary>
  assert.equal(indicators.csat, 100)
  assert.equal(indicators.registros_excluidos, 1)
  assert.equal(indicators.atendimentos, 100)
  assert.equal(JSON.stringify(result).includes('analyst_id'), false)
})

test('oficial não substitui fechamento ausente por dados atuais e preserva payload', async () => {
  const period = parseQuery(new Request('https://example.test/?mes=2026-08&canal=telefone&fonte=oficial'))
  await assert.rejects(officialIndicators(database({}), period), (error: unknown) => error instanceof ApiError && error.status === 404)
  const result = await officialIndicators(database({ integration_closures: [{ id: 'snapshot', month: '2026-08', channel: 'telefone', team: 'all', created_at: '2026-09-01', payload: { indicadores: { csat_n1: 87 } } }] }), period)
  assert.equal(result.indicadores.csat_n1, 87)
  assert.equal(result.status, 'fechado')
})

test('CSAT do telefone pondera avaliações, chat preserva média simples', () => {
  assert.equal(calculateAverageCsat([{ csat: 100, total_reviews: 1, total_tickets: 10 }, { csat: 50, total_reviews: 9, total_tickets: 20 }]), 55)
  assert.equal(calculateChatAverage([{ csat: 100, review_percentage: 0, sending_percentage: 0 }, { csat: 50, review_percentage: 0, sending_percentage: 0 }], 'csat'), 75)
})
test('ausência de dados é distinta de zero; denominadores vazios não produzem NaN', () => {
  assert.equal(phoneSummary([], []).csat_n1, null)
  assert.equal(chatSummary([], 2).csat, null)
  assert.equal(chatSummary([], 2).registros_excluidos, 2)
  assert.equal(phoneSummary([{ csat: 0, total_reviews: 1, total_tickets: 1 }], []).csat_n1, 0)
  assert.equal(calculateAverageCsat([{ csat: 80, total_reviews: 0, total_tickets: 0 }]), 80)
})
test('períodos, anos bissextos e filtros inválidos', () => {
  const query = (s: string, weekly = false) => parseQuery(new Request(`https://example.test/?${s}`), weekly)
  assert.equal(query('mes=2024-02&canal=chat').end, '2024-02-29')
  for (const s of ['mes=2026-13&canal=chat', 'mes=2026-01&canal=x', 'mes=2026-01&canal=chat&extra=1', 'mes=2026-01&canal=chat&canal=telefone', 'mes=2026-01&canal=telefone&equipe=x']) assert.throws(() => query(s), ApiError)
  assert.throws(() => query('inicio=2026-02-30&fim=2026-03-01', true), ApiError)
  assert.throws(() => query('inicio=2026-01-01&fim=2026-12-31', true), ApiError)
  assert.equal(query('inicio=2026-08-01&fim=2026-08-31', true).channel, 'telefone')
})
test('credenciais inválidas, expiradas e configuração ausente falham fechadas', () => {
  const token = 'test-secret-with-at-least-32-characters'
  const client = { id: 'projetos', sha256: createHash('sha256').update(token).digest('hex'), expires_at: '2099-01-01', channels: ['chat'] }
  assert.equal(findConsumer(token, JSON.stringify([client])).id, 'projetos')
  assert.throws(() => findConsumer('invalid', JSON.stringify([client])), ApiError)
  assert.throws(() => findConsumer(token, JSON.stringify([{ ...client, expires_at: '2020-01-01' }])), ApiError)
  assert.throws(() => findConsumer(token, undefined), ApiError)
  assert.throws(() => findConsumer(token, '{}'), ApiError)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError, authorizeConsumer, resolveConsumer } from '../src/lib/integration-server.ts'
import { createIntegrationKey, listIntegrationKeys, revokeIntegrationKey, validateKeyInput } from '../src/lib/integration-key-management.ts'

test('entrada da geração valida nome, canais e prazo; não aceita permissão arbitrária', () => {
  assert.equal(validateKeyInput({ name: ' Projetos ', channels: ['chat'], validity_days: 90 }).name, 'Projetos')
  const valid = { name: 'Projetos', channels: ['chat'], validity_days: 90 }
  for (const input of [null, [], {}, { ...valid, name: 'x' }, { ...valid, name: 'a\nb' }, { ...valid, channels: [] }, { ...valid, channels: ['chat', 'chat'] }, { ...valid, channels: ['users'] }, { ...valid, validity_days: '90' }, { ...valid, validity_days: 0 }, { ...valid, validity_days: 999 }, { ...valid, role: 'master' }]) assert.throws(() => validateKeyInput(input), ApiError)
})

test('ciclo da chave: geração guarda hash, consulta aceita canal, listagem oculta segredo e revogação bloqueia', async (t) => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, clients: process.env.INTEGRATION_CLIENTS_JSON }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  delete process.env.INTEGRATION_CLIENTS_JSON
  t.after(() => {
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: previous.url, SUPABASE_SERVICE_ROLE_KEY: previous.key, INTEGRATION_CLIENTS_JSON: previous.clients })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  })
  type Row = Record<string, unknown>
  let stored: Row | undefined
  let keyLookupFailed = false
  let limit = true
  let updateCount = 0
  const project = (row: Row, fields: string) => Object.fromEntries(fields.split(',').map(field => [field, row[field]]))
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    if (url.pathname.endsWith('/rpc/consume_integration_request')) return Response.json(limit)
    assert.ok(url.pathname.endsWith('/integration_keys'))
    if (method === 'POST') {
      stored = { ...JSON.parse(String(init?.body)), id: '12345678-1234-1234-1234-123456789012', created_at: new Date().toISOString(), revoked_at: null, revoked_by: null }
      return Response.json(project(stored!, url.searchParams.get('select')!), { status: 201 })
    }
    if (method === 'PATCH') {
      if (stored?.revoked_at) return Response.json([])
      assert.equal(url.searchParams.get('revoked_at'), 'is.null')
      updateCount++
      stored = { ...stored, ...JSON.parse(String(init?.body)) }
      return Response.json([project(stored!, url.searchParams.get('select')!)])
    }
    const hash = url.searchParams.get('token_hash')
    if (hash && keyLookupFailed) return Response.json({ message: 'database unavailable' }, { status: 503 })
    if (hash) return Response.json(stored && hash === `eq.${stored.token_hash}` ? [project(stored, url.searchParams.get('select')!)] : [])
    const fields = url.searchParams.get('select')!
    assert.ok(!fields.includes('token_hash'))
    return Response.json(stored ? [project(stored, fields)] : [])
  })
  const admin = createClient('https://supabase.example.test', 'test-service-key', { auth: { persistSession: false } })
  const created = await createIntegrationKey(admin, 'master-user', { name: 'Projetos', channels: ['chat'], validity_days: 30 })
  assert.match(created.token, /^cp_[A-Za-z0-9_-]{43}$/)
  assert.equal(stored!.token_hash, createHash('sha256').update(created.token).digest('hex'))
  assert.ok(!JSON.stringify(stored).includes(created.token))
  assert.ok(!('token_hash' in created.key))
  assert.equal(stored!.created_by, 'master-user')
  const request = new Request('https://painel.example.test', { headers: { Authorization: `Bearer ${created.token}` } })
  await authorizeConsumer(request, 'chat')
  await assert.rejects(authorizeConsumer(request, 'telefone'), (e: unknown) => e instanceof ApiError && e.status === 403)
  limit = false
  await assert.rejects(authorizeConsumer(request, 'chat'), (e: unknown) => e instanceof ApiError && e.status === 429)
  limit = true
  const listing = await listIntegrationKeys(admin, 1)
  assert.equal(listing.keys.length, 1)
  assert.ok(!JSON.stringify(listing).includes(created.token))
  assert.ok(!JSON.stringify(listing).includes(String(stored!.token_hash)))
  stored!.expires_at = '2020-01-01'
  await assert.rejects(authorizeConsumer(request, 'chat'), (e: unknown) => e instanceof ApiError && e.status === 401)
  stored!.expires_at = '2099-01-01'
  keyLookupFailed = true
  await assert.rejects(authorizeConsumer(request, 'chat'), (e: unknown) => e instanceof ApiError && e.status === 503)
  keyLookupFailed = false
  const revoked = await revokeIntegrationKey(admin, 'master-user', created.key.id)
  assert.ok(revoked.key.revoked_at)
  assert.equal(stored!.revoked_by, 'master-user')
  await revokeIntegrationKey(admin, 'another-master', created.key.id)
  assert.equal(updateCount, 1)
  assert.equal(stored!.revoked_by, 'master-user')
  await assert.rejects(authorizeConsumer(request, 'chat'), (e: unknown) => e instanceof ApiError && e.status === 401)
  // Even a matching obsolete environment entry must not reactivate a managed key.
  const legacy = JSON.stringify([{ id: 'legacy', sha256: stored!.token_hash, channels: ['chat'], expires_at: '2099-01-01' }])
  await assert.rejects(resolveConsumer(admin, created.token, legacy), (e: unknown) => e instanceof ApiError && e.status === 401)
})

test('chaves antigas do ambiente continuam aceitas sem depender da tabela nova', async () => {
  const token = 'existing-environment-secret-123456'
  const config = JSON.stringify([{ id: 'painel-validacao', sha256: createHash('sha256').update(token).digest('hex'), channels: ['telefone'], expires_at: '2099-01-01' }])
  const admin = createClient('https://supabase.example.test', 'test-service-key', { auth: { persistSession: false } })
  assert.equal((await resolveConsumer(admin, token, config)).id, 'painel-validacao')
})

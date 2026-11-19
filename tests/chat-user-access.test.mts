import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const chatId = '598d5aec-15c8-4504-85f7-4521c1a040fc'
const source = readFileSync(new URL('../src/app/api/users/route.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, '').replace(/export /g, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + '\nPOST'
function harness({ role = 'master', enabled = true, active = true, registered = true } = {}) {
  const created: unknown[] = [], profiles: Record<string, unknown>[] = []
  const admin = { auth: { getUser: async () => ({ data: { user: { id: 'manager', user_metadata: { role: 'master' } } }, error: null }), admin: { createUser: async (body: unknown) => { created.push(body); return { data: { user: { id: 'new-user' } }, error: null } } } },
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: null, data: table === 'profiles' ? { role } : table === 'chat_analysts' ? { id: chatId, name: 'Thiago Reis', active } : registered ? { clickdesk_owner_id: 85 } : null }), upsert: async (profile: Record<string, unknown>) => { profiles.push(profile); return { error: null } } }
      return q
    },
  }
  const post = vm.runInNewContext(code, { NextResponse: Response, createClient: () => admin, isChatProductionEnabled: () => enabled, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } } }) as (request: Request) => Promise<Response>
  return { created, profiles, post: (body: Record<string, unknown>, token = true) => post(new Request('https://example.test/api/users', { method: 'POST', headers: token ? { authorization: 'Bearer fixture' } : {}, body: JSON.stringify(body) })) }
}
const body = { fullName: 'Thiago Reis', email: 'fixture@example.test', password: 'fixture-password', role: 'analista', chatAnalystId: chatId }
test('só gestão autenticada pode criar acesso e metadados editáveis não concedem permissão', async () => {
  const anon = harness(); assert.equal((await anon.post(body, false)).status, 401); assert.equal(anon.created.length, 0)
  const analyst = harness({ role: 'analista' }); assert.equal((await analyst.post(body)).status, 403); assert.equal(analyst.created.length, 0)
})
test('Chat desligado, cadastro inativo e pessoa fora do quadro não criam login', async () => {
  for (const options of [{ enabled: false }, { active: false }, { registered: false }]) {
    const h = harness(options); assert.ok([400, 404].includes((await h.post(body)).status)); assert.equal(h.created.length, 0)
  }
})
test('acesso Chat recebe somente vínculo Chat e não pode combinar vínculo de Telefone', async () => {
  const h = harness(); assert.equal((await h.post(body)).status, 200); assert.equal(h.profiles[0].chat_analyst_id, chatId); assert.equal(h.profiles[0].analyst_id, null)
  const invalid = harness(); assert.equal((await invalid.post({ ...body, analystId: 'phone' })).status, 400); assert.equal(invalid.created.length, 0)
})
test('criação de acesso Telefone conserva o vínculo anterior e não recebe vínculo Chat', async () => {
  const h = harness(); const { chatAnalystId: omitted, ...phone } = body; void omitted
  assert.equal((await h.post({ ...phone, analystId: 'phone' })).status, 200); assert.equal(h.profiles[0].analyst_id, 'phone'); assert.equal('chat_analyst_id' in h.profiles[0], false)
})

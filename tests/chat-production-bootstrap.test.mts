import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/app/api/chat-production/bootstrap/route.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, '').replace(/export /g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText + '\nPOST'
const production = { CHAT_PRODUCTION_BOOTSTRAP_ENABLED: 'true', VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://qmetbydkepfdgfqkdkai.supabase.co', CLICKDESK_API_KEY: 'source-fixture', CLICKDESK_ACCOUNT_ID: 'account-fixture' }
function harness(env = production, authenticated = true, conflict = false) {
  const calls: unknown[] = []
  const post = vm.runInNewContext(code, { process: { env }, json: Response.json, isCxCron: () => authenticated,
    adminClient: () => ({ rpc: async (name: string, params: unknown) => { calls.push({ name, params }); return { data: !conflict, error: conflict ? {} : null } } }),
  }) as (request: Request) => Promise<Response>
  return { calls, post: () => post(new Request('https://example.test', { method: 'POST' })) }
}
test('bootstrap exige liberação temporária, produção exata e token autorizado antes de acessar Vault', async () => {
  for (const env of [{ ...production, CHAT_PRODUCTION_BOOTSTRAP_ENABLED: 'false' }, { ...production, VERCEL_ENV: 'preview' }, { ...production, NEXT_PUBLIC_SUPABASE_URL: 'https://vvtorcvchnqhcredhorv.supabase.co' }]) {
    const h = harness(env); assert.equal((await h.post()).status, 404); assert.equal(h.calls.length, 0)
  }
  const h = harness(production, false); assert.equal((await h.post()).status, 401); assert.equal(h.calls.length, 0)
})
test('bootstrap envia configuração só ao inicializador restrito e nunca devolve credenciais', async () => {
  const h = harness(), response = await h.post()
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { initialized: true })
  assert.equal(JSON.parse(JSON.stringify(h.calls))[0].name, 'initialize_clickdesk_production_credentials')
  assert.equal(JSON.parse(JSON.stringify(h.calls))[0].params.p_api_key, 'source-fixture')
})
test('configuração existente não é substituída e detalhes internos não são expostos', async () => {
  const h = harness(production, true, true), response = await h.post()
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /source-fixture|account-fixture/)
})

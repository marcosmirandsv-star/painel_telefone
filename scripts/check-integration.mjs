// Usage: node --env-file=.env.integration-validation scripts/check-integration.mjs
// Reads the secret from the local environment; never prints it.
import assert from 'node:assert/strict'
const base = process.env.PAINEL_URL
const token = process.env.PAINEL_TOKEN
if (!base || !token) throw new Error('Configure PAINEL_URL e PAINEL_TOKEN no ambiente local.')
if (new URL(base).protocol !== 'https:') throw new Error('A validação remota exige HTTPS.')
async function check(name, path, status, authorization = token, method = 'GET') {
  const response = await fetch(new URL(path, base), {
    method,
    headers: authorization ? { Authorization: `Bearer ${authorization}` } : {},
    redirect: 'error', signal: AbortSignal.timeout(30000),
  })
  assert.equal(response.status, status, `${name}: HTTP ${response.status}, esperado ${status}`)
  const body = status === 405 ? null : await response.json()
  if (status === 200) {
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.ok(body.indicadores)
    assert.equal('analyst_id' in body, false)
  }
  console.log(JSON.stringify({ teste: name, status: response.status, ...(status === 200 ? { canal: body.canal, tem_dados: body.tem_dados, indicadores: body.indicadores } : {}) }))
  return body
}
await check('Sem credencial', '/api/v1/indicadores/mensais?mes=2026-08&canal=telefone', 401, null)
await check('Credencial inválida', '/api/v1/indicadores/mensais?mes=2026-08&canal=telefone', 401, 'invalid-credential-with-more-than-20-characters')
await check('Consulta mensal de telefone', '/api/v1/indicadores/mensais?mes=2026-08&canal=telefone', 200)
await check('Consulta mensal de chat', '/api/v1/indicadores/mensais?mes=2026-08&canal=chat', 200)
await check('Consulta semanal de telefone', '/api/v1/indicadores/semanais?inicio=2026-08-01&fim=2026-08-31', 200)
await check('Data inválida', '/api/v1/indicadores/semanais?inicio=2026-02-30&fim=2026-03-01', 400)
await check('Escrita externa indisponível', '/api/v1/indicadores/mensais?mes=2026-08&canal=telefone', 405, token, 'POST')
await check('Credencial externa sem acesso de gestão', '/api/integrations/closures?mes=2026-08&canal=telefone', 401)
console.log('Validação remota concluída.')

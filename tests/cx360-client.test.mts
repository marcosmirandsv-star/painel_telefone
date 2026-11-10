import test from 'node:test'
import assert from 'node:assert/strict'
import { withCxDeadline, readCxResponse } from '../src/lib/cx360-client.ts'

test('autenticação travada termina com mensagem e permite nova tentativa', async () => {
  let aborted = false
  await assert.rejects(withCxDeadline(new Promise<never>(() => {}), 5, () => { aborted = true }), /Tente novamente/)
  assert.equal(aborted, true)
  assert.equal(await withCxDeadline(Promise.resolve('sessão validada'), 100), 'sessão validada')
})
test('erro de rede é preservado e resposta tardia não reabre a operação', async () => {
  await assert.rejects(withCxDeadline(Promise.reject(new Error('Sem conexão')), 100), /Sem conexão/)
  let resolve!: (value: number) => void
  const pending = new Promise<number>(done => { resolve = done })
  await assert.rejects(withCxDeadline(pending, 5), /demorou/)
  resolve(42)
})
test('respostas inválidas e sessão expirada são apresentadas sem erro técnico de JSON', async () => {
  await assert.rejects(readCxResponse(new Response('<html>indisponível</html>', { status: 502 })), /forma inesperada/)
  await assert.rejects(readCxResponse(Response.json({ erro: 'Sessão inválida' }, { status: 401 })), /Sessão inválida/)
  await assert.rejects(readCxResponse(Response.json({}, { status: 503 })), /Consulta indisponível/)
  assert.deepEqual(await readCxResponse(Response.json({ cases: [] })), { cases: [] })
})

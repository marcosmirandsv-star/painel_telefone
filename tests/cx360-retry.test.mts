import test from 'node:test'
import assert from 'node:assert/strict'
import { cxRetry } from '../src/lib/cx360-retry.ts'
test('indisponibilidade e limite da infraestrutura preservam a tentativa mesmo na terceira execução',()=>{
 for(const code of ['provider_http_503','provider_http_500','provider_rate_limit','source_unavailable','source_rate_limit','network_timeout']){
  const r=cxRetry(code,3);assert.equal(r.status,'pending');assert.equal(r.attempts,2);assert.ok(r.delayMs>=300000)
 }
})
test('conteúdo inválido não recebe tentativas ilimitadas nem é publicado como diagnóstico',()=>{
 assert.equal(cxRetry('provider_invalid_json',3).status,'failed')
 assert.equal(cxRetry('analysis_unavailable',2).status,'pending')
 assert.equal(cxRetry('provider_http_403',3).status,'failed')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {composeCxCoverage} from '../src/lib/cx360-coverage.ts'
import {cxErrorCode,cxRetry} from '../src/lib/cx360-retry.ts'
const capture=(start_date:string,end_date:string,status='complete',created_at='2026-11-12T09:00:00Z')=>({start_date,end_date,status,created_at})
test('compõe intervalos completos sobrepostos sem exigir recaptura integral',()=>{
 const r=composeCxCoverage('2026-11-01','2026-11-11',[capture('2026-11-01','2026-11-10','complete','2026-11-11T12:42:00Z'),capture('2026-11-05','2026-11-11')]);assert.equal(r.status,'complete');assert.equal(r.composed,true);assert.equal(r.created_at,'2026-11-11T12:42:00Z');assert.deepEqual(r.missing_days,[])
})
test('lacunas e capturas falhadas não viram cobertura confirmada',()=>{
 const r=composeCxCoverage('2026-11-01','2026-11-11',[capture('2026-11-01','2026-11-09'),capture('2026-11-10','2026-11-11','failed')]);assert.equal(r.status,'incomplete');assert.deepEqual(r.missing_days,['2026-11-10','2026-11-11'])
})
test('uma captura mais recente integral substitui combinação antiga',()=>{
 const r=composeCxCoverage('2026-11-01','2026-11-11',[capture('2026-11-01','2026-11-10','complete','2026-11-10T10:00:00Z'),capture('2026-11-01','2026-11-11')]);assert.equal(r.captures,1);assert.equal(r.composed,false)
})
test('classifica falhas concretas sem persistir mensagem arbitrária nem relaxar evidências',()=>{
 assert.equal(cxErrorCode(new Error('Histórico paginado exige leitura integral.')),'source_history_paginated')
 assert.equal(cxErrorCode(new Error('Conduta sem mensagem pública da pessoa avaliada.')),'provider_evidence_invalid')
 assert.equal(cxRetry(cxErrorCode(new Error('Conduta sem mensagem pública da pessoa avaliada.')),3).status,'failed')
 assert.equal(cxErrorCode(new Error('payload privado de cliente')),'analysis_unavailable')
 assert.equal(cxErrorCode(new SyntaxError('private provider body')),'provider_invalid_json')
 assert.equal(cxErrorCode(new Error('provider_http_503')),'provider_http_503')
})

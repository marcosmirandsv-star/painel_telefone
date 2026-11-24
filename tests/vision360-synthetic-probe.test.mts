import {test} from 'node:test'
import assert from 'node:assert/strict'
import {syntheticAnalysisProbe,syntheticReferenceShape} from '../src/lib/vision360-activation/synthetic-probe.ts'
test('full synthetic diagnostic uses only provider network and never real source or business persistence',async()=>{
 let calls=0
 const mock=(async(input:URL|RequestInfo,init?:RequestInit)=>{
  assert.ok(String(input).startsWith('https://generativelanguage.googleapis.com/'))
  const body=String(init?.body);assert.ok(body.includes('Analista Sintético'));assert.ok(!body.includes('Thiago Reis'))
  calls++
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({initial_sentiment:'unclear',final_sentiment:'unclear',primary_cause:{category:'unclear',summary:'Contexto fictício.',confidence:'low'},human_influence:{classification:'neutral',summary:'Orientação registrada.',confidence:'low'},controllability:{classification:'unclear',summary:'Contexto fictício.'},coaching_signal:{available:false,summary:'Leitura fictícia.'},analyst_takeaway:{kind:'maintain',summary:'Manter clareza dos próximos passos.',confidence:'low'},evidence_summary:['Orientação registrada.'],limitations:[],cx_coaching:{},evidence_refs:[{reference_id:'E1',scope:'analyst_behavior'}]})}]}}]})
 }) as typeof fetch
 const result=await syntheticAnalysisProbe({GEMINI_API_KEY:'test-only'},mock)
 assert.equal(calls,2);assert.equal(result.database_mutations,0);assert.equal(result.customer_data_sent,false);assert.equal(result.result.results[0].status,'done');assert.ok(result.analysis)
 assert.equal(result.provider_contracts.length,2);assert.equal(result.provider_contracts[0].invalid_reference_count,0)
})
test('synthetic structure diagnostics reveal no model prose, ids, quote or unexpected key names',()=>{
 const summary=syntheticReferenceShape({evidence_refs:[{reference_id:'secret-id',scope:'secret-scope','secret-key':'secret-value'},{reference_id:'E1',scope:'context'},{reference_id:'E1',scope:'analyst_behavior'}]},['E1'])
 assert.equal(summary.invalid_reference_count,1);assert.equal(summary.duplicate_reference_count,1);assert.equal(summary.unexpected_field_count,1)
 assert.ok(!JSON.stringify(summary).includes('secret'))
})
test('full synthetic failures report exact evidence reason without persisting or exposing generated text',async()=>{
 let calls=0
 const response={evidence_refs:[{reference_id:'untrusted-secret-id',scope:'context'}],explanation:'untrusted-secret-prose'}
 const mock=(async()=>{calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]})}) as typeof fetch
 const result=await syntheticAnalysisProbe({GEMINI_API_KEY:'test-only'},mock)
 assert.equal(calls,1);assert.equal(result.analysis,null);assert.equal(result.database_mutations,0)
 assert.equal(result.provider_contracts[0].invalid_reference_count,1)
 const first=result.result.results[0]
 assert.equal(first.status,'failed')
 assert.equal('evidence_error' in first&&first.evidence_error?.reason,'unknown_reference')
 assert.ok(!JSON.stringify(result).includes('untrusted-secret'))
})


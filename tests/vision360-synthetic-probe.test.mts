import {test} from 'node:test'
import assert from 'node:assert/strict'
import {syntheticAnalysisProbe} from '../src/lib/vision360-activation/synthetic-probe.ts'
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
})

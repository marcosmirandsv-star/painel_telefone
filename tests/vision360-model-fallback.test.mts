import test from 'node:test'
import assert from 'node:assert/strict'
import {withModelFallback} from '../src/lib/vision360-activation/model-fallback.ts'
test('503 switches once to alternate and records actual successful model',async()=>{
 const calls:string[]=[]
 const result=await withModelFallback('gemini-3.5-flash-lite',async model=>{calls.push(model);if(calls.length===1)throw Error('503');return 'verified'},e=>e instanceof Error&&e.message==='503')
 assert.deepEqual(calls,['gemini-3.5-flash-lite','gemini-3.6-flash'])
 assert.equal(result.model,'gemini-3.6-flash');assert.equal(result.value,'verified')
 assert.deepEqual(result.attempts.map(x=>x.status),['failed','succeeded'])
})
test('successful primary does not call alternatives',async()=>{
 const result=await withModelFallback('gemini-3.5-flash-lite',async()=>true,()=>true)
 assert.equal(result.attempts.length,1)
})
test('invalid evidence, auth, quota and malformed requests cannot be hidden by fallback',async()=>{
 for(const code of ['evidence_reference_invalid','401','403','429','400']){
  let calls=0
  await assert.rejects(withModelFallback('gemini-3.5-flash-lite',async()=>{calls++;throw Error(code)},()=>false))
  assert.equal(calls,1)
 }
})
test('all unavailable models stop at finite deduplicated list',async()=>{
 let calls=0
 await assert.rejects(withModelFallback('gemini-3.6-flash',async()=>{calls++;throw Error('503')},()=>true),/503/)
 assert.equal(calls,2)
})
test('fallback repeats a full independent pair instead of combining models',async()=>{
 const reads:string[]=[]
 let pass=0
 const result=await withModelFallback('gemini-3.5-flash-lite',async model=>{
  reads.push(model+':1');pass++
  reads.push(model+':2')
  if(pass===1)throw Error('503')
  return [model,model]
 },()=>true)
 assert.deepEqual(result.value,['gemini-3.6-flash','gemini-3.6-flash'])
 assert.equal(reads.length,4)
})

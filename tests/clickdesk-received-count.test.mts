import test from 'node:test'
import assert from 'node:assert/strict'
import {receivedCount,receivedForOwner} from '../supabase/functions/clickdesk-official-metrics-sync/received.ts'

test('volume vem de Recebidos, preservando a distinção entre 112 entradas, 107 resoluções e 105 respostas',()=>{
  const report={summary:{received:{value:112},resolved:107},agents:[{id:54,conversations:105,resolved:107}]}
  assert.equal(receivedForOwner(report,54),112)
  assert.equal(receivedCount(report),112)
})
test('resposta inválida ou filtro de pessoa desrespeitado impede gravar volume',()=>{
  for(const value of [undefined,null,'112',-1,1.5])assert.throws(()=>receivedForOwner({summary:{received:{value}},agents:[]},54))
  assert.throws(()=>receivedForOwner({summary:{received:{value:112}},agents:[{id:55}]},54))
  assert.throws(()=>receivedForOwner({summary:{received:{value:112}}},54))
  assert.equal(receivedForOwner({summary:{received:{value:0}},agents:[]},54),0)
})

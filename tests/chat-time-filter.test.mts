import test from 'node:test'
import assert from 'node:assert/strict'
import {chatTimeRange} from '../src/lib/chat-time-filter.ts'
const now=new Date('2026-11-11T12:00:00Z')
test('mês mantém todos os dias at� hoje, dia é exato e semana começa segunda e termina domingo',()=>{
 assert.deepEqual(chatTimeRange('2026-11','month','',now),{start:'2026-11-01',end:'2026-11-11'})
 assert.deepEqual(chatTimeRange('2026-11','day','2026-11-04',now),{start:'2026-11-04',end:'2026-11-04'})
 assert.deepEqual(chatTimeRange('2026-11','week','2026-11-04',now),{start:'2026-11-02',end:'2026-11-08'})
})
test('semana respeita virada de mês, dia fechado em Brasília e troca de competência',()=>{
 assert.deepEqual(chatTimeRange('2026-11','week','2026-11-01',now),{start:'2026-11-01',end:'2026-11-01'})
 assert.deepEqual(chatTimeRange('2026-11','week','2026-11-10',now),{start:'2026-11-09',end:'2026-11-11'})
 assert.deepEqual(chatTimeRange('2026-10','day','2026-11-10',now),{start:'2026-10-31',end:'2026-10-31'})
 assert.deepEqual(chatTimeRange('2026-11','day','2026-11-11',new Date('2026-11-11T01:00:00Z')),{start:'2026-11-10',end:'2026-11-10'})
})

test('primeiro dia do mês não publica dias futuros nem derruba a tela',()=>{
 assert.deepEqual(chatTimeRange('2026-11','month','',new Date('2026-11-01T12:00:00Z')),{start:'2026-11-01',end:'2026-11-01'})
})

test('custom interval preserves both inclusive dates requested by the manager',()=>{
 assert.deepEqual(chatTimeRange('2026-11','custom','2026-11-01/2026-11-11',now),{start:'2026-11-01',end:'2026-11-11'})
 assert.deepEqual(chatTimeRange('2026-11','custom','2026-11-05/2026-11-09',now),{start:'2026-11-05',end:'2026-11-09'})
 assert.deepEqual(chatTimeRange('2026-11','custom','2026-11-05/2026-11-05',now),{start:'2026-11-05',end:'2026-11-05'})
})
test('custom interval clamps future days and resets invalid or previous-month selections',()=>{
 assert.deepEqual(chatTimeRange('2026-11','custom','2026-11-05/2026-11-30',now),{start:'2026-11-05',end:'2026-11-11'})
 for(const reference of ['','2026-11-09/2026-11-05','2026-11-31/2026-11-31','2026-10-05/2026-10-09'])assert.deepEqual(chatTimeRange('2026-11','custom',reference,now),{start:'2026-11-01',end:'2026-11-11'})
 assert.deepEqual(chatTimeRange('2024-02','custom','2024-02-28/2024-02-29',now),{start:'2024-02-28',end:'2024-02-29'})
})

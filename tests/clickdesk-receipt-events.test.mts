import test from 'node:test'
import assert from 'node:assert/strict'
import {projectTicketReceipts} from '../src/lib/clickdesk-receipt-events.ts'
const people=[{id:'jp',name:'João Pedro Vianey',team_id:'fiscal'},{id:'karol',name:'Karolyne Moreira',team_id:'erp'}]
const events=[
 {id:'1',field:'department',old:null,new:'Suporte - Fiscal',created_at:'2026-11-10T17:43:37Z'},
 {id:'2',field:'owner',old:null,new:'João Pedro Vianey',created_at:'2026-11-10T17:43:58Z'},
 {id:'3',field:'owner',old:'João Pedro Vianey',new:null,created_at:'2026-11-11T13:20:19Z'},
 {id:'4',field:'owner',old:null,new:'Karolyne Moreira',created_at:'2026-11-11T13:23:26Z'},
]
test('transferência em 11/11 preserva o crédito de João Pedro no dia 10 e cria o da Karolyne no dia 11',()=>{
 const rows=projectTicketReceipts('1091924',events,people,true)
 assert.deepEqual(rows.map(row=>[row.analyst_id,row.occurred_date]),[['jp','2026-11-10'],['karol','2026-11-11']])
 assert.deepEqual(projectTicketReceipts('1091924',events.slice(0,2),people,true)[0],rows[0])
})
test('duplicação do evento, retomada pela mesma pessoa e ausência de mensagem não duplicam um recebimento',()=>{
 const rows=projectTicketReceipts('email',[...events,events[3],{...events[3],id:'5',created_at:'2026-11-12T13:00:00Z'}],people,true)
 assert.equal(rows.length,2)
})
test('datas seguem Brasília e história incompleta ou ID conflitante não publica crédito',()=>{
 const rows=projectTicketReceipts('x',[events[0],{...events[3],created_at:'2026-11-11T02:59:59Z'}],people,true)
 assert.equal(rows[0].occurred_date,'2026-11-10')
 assert.throws(()=>projectTicketReceipts('x',events,people,false),/incomplete/)
 assert.throws(()=>projectTicketReceipts('x',[...events,{...events[3],new:'Outra pessoa'}],people,true),/conflict/)
})

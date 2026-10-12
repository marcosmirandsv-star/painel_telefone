import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyHumanTicketCoverage } from '../supabase/functions/clickdesk-d1-sync/coverage.ts'

test('não aceita sincronização vazia quando relatório oficial registra atendimentos', () => {
  assert.deepEqual(verifyHumanTicketCoverage({ticketCollectionSize:0,reportAgentReceived:241}),
    {ok:false,code:'empty_with_report_activity'})
})
test('permite coleção não vazia sem afirmar igualdade entre métricas diferentes', () => {
  assert.deepEqual(verifyHumanTicketCoverage({ticketCollectionSize:15,reportAgentReceived:241}),
    {ok:true,code:'ok'})
})
test('distingue ausência total de evidência da divergência confirmada', () => {
  assert.deepEqual(verifyHumanTicketCoverage({ticketCollectionSize:0,reportAgentReceived:0}),
    {ok:true,code:'no_reference_activity'})
})
test('rejeita métricas inválidas', () => {
  assert.throws(() => verifyHumanTicketCoverage({ticketCollectionSize:-1,reportAgentReceived:1}),/Invalid/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('A fila 360 usa somente tickets finais avaliados e respeita a autoria da análise',()=>{
  const route=read('src/app/api/clickdesk/operation-360/route.ts')
  assert.match(route,/readFinalLedger\(admin/)
  assert.doesNotMatch(route,/\.from\('clickdesk_chat_attendances'\)/)
  assert.match(route,/row\.analyst_id === owner\.analyst_id/)
  assert.match(route,/row\.satisfaction_label === owner\.satisfaction_label/)
  assert.match(route,/source_coverage/)
  assert.match(route,/audit_sample_only/)
  assert.match(route,/unanalyzedNegative/)
  assert.match(route,/unanalyzedPositive/)
})

test('Análise individual consulta o ledger autenticado e preserva verificação de titular e pendências',()=>{
  const route=read('src/app/api/clickdesk/qualitative/route.ts')
  assert.match(route,/sessionAccess\.admin[\s\S]*?\.from\('clickdesk_final_ticket_ledger'\)/)
  assert.doesNotMatch(route,/loadFinalSnapshot\(homologationReadAdmin\(\)\)/)
  assert.match(route,/final\.analyst_id !== sessionAccess\.chatAnalystId/)
  assert.match(route,/\.from\('clickdesk_final_ticket_pending'\)/)
  assert.match(route,/validation_status: 'pending'/)
})

test('Resumo qualitativo usa ledger e não considera cache de outra pessoa ou avaliação',()=>{
  const route=read('src/app/api/clickdesk/qualitative-summary/route.ts')
  assert.match(route,/readFinalLedger\(access\.admin/)
  assert.doesNotMatch(route,/\.from\('clickdesk_chat_attendances'\)/)
  assert.match(route,/item\.analyst_id === owner\.analyst_id/)
  assert.match(route,/item\.satisfaction_label === owner\.satisfaction_label/)
  assert.match(route,/audit_sample_only/)
})

test('Conferência complementar é exclusiva de gestores, não confunde participação com atendimento final',()=>{
  const route=read('src/app/api/clickdesk/verified-coverage/route.ts')
  assert.match(route,/!access\.isManagement/)
  assert.match(route,/clickdesk_chat_verified_contributions/)
  assert.match(route,/rating_attribution==='last_public_human_answer'/)
  assert.match(route,/distinct_tickets_with_human_contribution/)
  assert.match(route,/complementary_evidence_not_final/)
  assert.doesNotMatch(route,/\.upsert\(|\.insert\(|\.delete\(|serviceRoleKey/)
  const page=read('src/app/page.tsx')
  assert.match(page,/Conferência complementar — demais analistas/)
  assert.match(page,/O CSAT abaixo usa exclusivamente avaliações/)
  assert.match(page,/IA e CSAT em cobertura parcial/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('produtividade usa apenas ledger; captura auxiliar aparece em ferramenta de auditoria',()=>{
  const page=read('src/app/page.tsx')
  const audit=page.indexOf('Auditoria das participações ClickDesk')
  const prod=page.lastIndexOf("{chatActiveTab === 'prototype' && (")
  const old=page.indexOf('Conferência complementar — demais analistas')
  assert.ok(audit>0 && prod>audit,'auditoria deve vir antes da aba produtividade')
  assert.equal(old,-1,'quadro de comparações indevidas deve desaparecer')
  const performance=page.slice(prod,page.indexOf("{chatActiveTab === 'import' ?",prod))
  assert.doesNotMatch(performance,/CSAT da amostra avaliada|Tickets com contribuição|Conferência complementar/)
  assert.match(performance,/chat2ProductivityRows\.map/)
  assert.match(page,/if \(!isManagementUser \|\| chatActiveTab !== 'analysis'\)/)
  assert.match(page,/Diagnóstico da captura auxiliar · participações, não atendimentos/)
  assert.match(page,/Captura|captura auxiliar/)
  assert.doesNotMatch(page,/O CSAT abaixo usa exclusivamente avaliações/)
})

test('endpoint de evidências não oferece outro CSAT e sinaliza inativos',()=>{
  const extra=read('src/app/api/clickdesk/verified-coverage/route.ts')
  assert.match(extra,/!access\.isManagement/)
  assert.match(extra,/clickdesk_chat_verified_contributions/)
  assert.match(extra,/distinct_tickets_with_human_contribution/)
  assert.match(extra,/active:person\.active/)
  assert.doesNotMatch(extra,/csat_of_verified_ratings/)
  assert.match(extra,/NÃO são outro CSAT|não calcular ou comparar CSAT/)
  assert.doesNotMatch(extra,/\.upsert\(|\.insert\(|\.delete\(/)
})

test('indicadores principais permanecem com autoria humana final única',()=>{
  const metrics=read('src/app/api/clickdesk/metrics/route.ts')
  assert.match(metrics,/readFinalLedger\(admin/)
  assert.match(metrics,/Number\(ticket\.satisfaction_label === 'positive'\)/)
  assert.match(metrics,/Number\(ticket\.satisfaction_label === 'negative'\)/)
  assert.doesNotMatch(metrics,/verified-coverage|clickdesk_chat_verified_contributions/)
  const page=read('src/app/page.tsx')
  assert.match(page,/const chat2ProductivityRows = \[\.\.\.chat2PersistedAnalystRows\]/)
  assert.match(page,/Os dados deste mês ainda são parciais/)
})

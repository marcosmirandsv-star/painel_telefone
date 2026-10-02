import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('360 e processamento completo continuam exclusivos da gestão', () => {
  const view = source('src/app/api/clickdesk/operation-360/route.ts')
  const processor = source('src/app/api/clickdesk/operation-360/process/route.ts')

  assert.match(view, /if \(!access\.isManagement\)[\s\S]{0,180}403/)
  assert.match(processor, /if \(!access\.isManagement\)[\s\S]{0,180}403/)
})

test('rotas individuais recusam analyst_id diferente do vínculo da sessão', () => {
  for (const path of [
    'src/app/api/clickdesk/metrics/route.ts',
    'src/app/api/clickdesk/history/route.ts',
    'src/app/api/clickdesk/tickets/route.ts',
  ]) {
    const text = source(path)
    assert.match(text, /!access\.isManagement/)
    assert.match(text, /access\.chatAnalystId/)
    assert.match(text, /403/)
  }
})

test('IA qualitativa valida o dono do ticket antes de consultar cache', () => {
  const text = source('src/app/api/clickdesk/qualitative/route.ts')
  const ownershipCheck = text.indexOf("persisted.data.analyst_id !== access.chatAnalystId")
  const cacheRead = text.indexOf("if (!body.force)")

  assert.ok(ownershipCheck >= 0, 'checagem explícita de propriedade do ticket deve existir')
  assert.ok(cacheRead >= 0, 'bloco de cache deve existir')
  assert.ok(
    ownershipCheck < cacheRead,
    'propriedade do ticket deve ser validada antes de qualquer reaproveitamento de cache',
  )
})

test('Escalas não usa fallback de usuário e só carrega dados após validar gestão', () => {
  const text = source('src/app/escalas/page.tsx')

  assert.doesNotMatch(text, /eq\('full_name',\s*'Marcos Miranda'\)/)
  assert.match(text, /authSupabase\.auth\.getUser\(\)/)
  assert.match(text, /Esta área é exclusiva da gestão/)

  const managementCheck = text.indexOf("const managementRole")
  const scheduleLoad = text.indexOf("supabase.from('schedule_teams')")
  assert.ok(managementCheck >= 0)
  assert.ok(scheduleLoad >= 0)
  assert.ok(
    managementCheck < scheduleLoad,
    'dados de Escalas não podem ser consultados antes da autorização gerencial',
  )
})

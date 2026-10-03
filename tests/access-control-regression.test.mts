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


test('Fechamentos e chaves de integração exigem gestão no backend', () => {
  const closures = source('src/app/api/integrations/closures/route.ts')
  const keys = source('src/app/api/integrations/keys/route.ts')
  const page = source('src/app/integracoes/page.tsx')

  assert.match(closures, /authorizeManager\(request\)/)
  assert.match(keys, /authorizeKeyAdmin\(request\)/)
  assert.match(page, /\['master', 'coordenadora', 'coordinator'\]/)
  assert.match(page, /Esta área é exclusiva da gestão/)
})

test('SQL de Escalas não reabre políticas amplas de homologação', () => {
  const moduleSql = source('supabase/schedule-module.sql')
  const saturdaySql = source('supabase/schedule-saturdays.sql')

  assert.match(moduleSql, /revoke all on table public\.%I from anon/)
  assert.match(moduleSql, /is_management_user/)
  assert.doesNotMatch(moduleSql, /for all to anon/)
  assert.doesNotMatch(moduleSql, /for all to authenticated using \(true\)/)

  assert.match(saturdaySql, /revoke all on public\.schedule_saturday_members from anon/)
  assert.match(saturdaySql, /schedule_saturday_members_management_all/)
  assert.doesNotMatch(saturdaySql, /using \(true\)/)
})


test('portal individual nunca usa o primeiro analista como fallback', () => {
  const page = source('src/app/page.tsx')
  assert.match(page, /find\(\(item\) => item\.analyst_id === analyst\.id\) \?\? null/)
  assert.doesNotMatch(page, /metrics\?\.by_analyst\?\.\[0\]/)
  assert.match(page, /Somente seus dados/)
})


test('automação 360 usa credencial interna e permanece restrita à homologação', () => {
  const autoProcessor = source('src/app/api/clickdesk/operation-360/auto-process/route.ts')
  const qualitative = source('src/app/api/clickdesk/qualitative/route.ts')
  const integrationServer = source('src/lib/integration-server.ts')
  const automationDb = source('supabase/functions/clickdesk-360-db/index.ts')

  assert.match(autoProcessor, /environment !== 'homologacao'/)
  assert.match(autoProcessor, /authorizeClickDeskAutomation\(request\)/)
  assert.match(autoProcessor, /callClickDeskAutomationDb/)
  assert.match(autoProcessor, /X-Central-Automation/)
  assert.match(qualitative, /x-central-automation/)
  assert.match(qualitative, /authorizeClickDeskAutomation\(request\)/)
  assert.match(qualitative, /callClickDeskAutomationDb/)
  assert.match(integrationServer, /functions\/v1\/clickdesk-360-db/)
  assert.match(automationDb, /get_clickdesk_cron_credentials/)
  assert.match(automationDb, /validation_status: 'pending'/)
})


test('menu lateral recolhe o submenu após a seleção para manter leitura compacta', () => {
  const page = source('src/app/page.tsx')

  for (const tab of ['dashboard', 'reports', 'entries', 'analysts', 'goals']) {
    const pattern = new RegExp(
      `setActiveTab\\('${tab}'\\); setExpandedSidebarModule\\(null\\)`,
    )
    assert.match(page, pattern)
  }

  for (const tab of [
    'overview',
    'operation360',
    'prototype',
    'podium',
    'reports',
    'analysis',
    'import',
    'settings',
  ]) {
    const pattern = new RegExp(
      `setChatActiveTab\\('${tab}'\\); setExpandedSidebarModule\\(null\\)`,
    )
    assert.match(page, pattern)
  }
})

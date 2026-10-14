import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('homologação e produção usam configuração única para credenciais de servidor', () => {
  const integration = source('src/lib/integration-server.ts')
  const finalOwner = source('src/lib/clickdesk-final-owner-server.ts')
  assert.match(integration, /export function adminClient\(\)[\s\S]*?getServerSupabaseConfig\(\)/)
  assert.match(integration, /authorizeClickDeskSessionClient\([\s\S]*?getServerSupabaseConfig\(\)/)
  assert.match(finalOwner, /export function homologationReadAdmin\(\)[\s\S]*?config\.environment !== 'homologacao'/)
  assert.match(finalOwner, /vvtorcvchnqhcredhorv\.supabase\.co/)
})

test('API nunca retorna zero comprovado quando todos os tickets estão inconclusivos', () => {
  const route = source('src/app/api/clickdesk/metrics/route.ts')
  assert.match(route, /snapshot\.candidates\.length > 0 && snapshot\.rows\.length === 0/)
  assert.match(route, /new ApiError\(503, 'Reconciliação ClickDesk sem atendimentos humanos confirmados/)
  assert.match(route, /const admin = homologationReadAdmin\(\)/)
  assert.doesNotMatch(route, /const admin = access\.admin/)
  assert.match(route, /!access\.isManagement/)
})

test('gestão mostra falha, carregamento e estado inconclusivo sem metas falsamente saudáveis', () => {
  const page = source('src/app/page.tsx')
  assert.match(page, /const \[clickDeskMetricsLoading, setClickDeskMetricsLoading\]/)
  assert.match(page, /setClickDeskMetricsLoading\(true\)/)
  assert.match(page, /Sessão indisponível\. Entre novamente no painel/)
  assert.match(page, /Não foi possível consultar a base ClickDesk/)
  assert.match(page, /Não é possível avaliar metas, prioridades ou avaliações negativas/)
  assert.match(page, /chat2ManagementRows\.length \? chat2ManagementHealthy\.length : '—'/)
  assert.match(page, /Tentar novamente/)
})

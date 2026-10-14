import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('descoberta remota é somente GET, autenticada como Master e não devolve payload de clientes', () => {
  const source = read('src/app/api/clickdesk/discovery/route.ts')
  assert.match(source, /await authorizeClickDeskSessionClient\(request\)/)
  assert.match(source, /access\.role !== 'master'/)
  assert.match(source, /method: 'GET'/)
  assert.doesNotMatch(source, /method: 'POST'|\.upsert\(|\.insert\(|\.delete\(/)
  assert.match(source, /page_items/)
  assert.match(source, /first_page_probe_only/)
})

test('reconciliação começa sempre em dry-run e rejeita gravação em preview de outra branch', () => {
  const source = read('src/app/api/clickdesk/reconcile/route.ts')
  assert.match(source, /const dryRun=body\.dry_run !== false/)
  assert.match(source, /process\.env\.VERCEL_GIT_COMMIT_REF !== 'homologacao'/)
  assert.match(source, /access\.role !== 'master'/)
  assert.match(source, /MAX_BATCH = 12/)
  assert.match(source, /const confirmed=evaluated\.filter\(row=>row\.confirmed\)/)
  assert.match(source, /const pending=evaluated\.filter\(row=>!row\.confirmed\)/)
  assert.match(source, /if\(!dryRun && selection\.length\)/)
  assert.match(source, /readTicketHistory/)
  assert.match(source, /finalHumanTicket/)
  assert.doesNotMatch(source, /['"]DELETE['"]|['"]PATCH['"]|['"]PUT['"]/)
})

test('ledger exclui tickets pendentes, mesmo com autoria previamente confirmada', () => {
  const source = read('src/lib/clickdesk-ledger-server.ts')
  assert.match(source, /clickdesk_final_ticket_pending/)
  assert.match(source, /records\.filter\(row => !pendingIds\.has\(row\.ticket_id\)\)/)
  assert.match(source, /filters\.teamId/)
  assert.match(source, /filters\.analystId/)
})

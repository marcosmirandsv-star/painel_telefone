import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFirstHumanAttendance } from '../src/lib/clickdesk-human-capture.ts'

const analysts = [
  { id: 'jv', team_id: 'especializado', name: 'João Vitor Almeida', identity_role: 'analyst' },
  { id: 'tr', team_id: 'especializado', name: 'Thiago Reis', identity_role: 'analyst' },
  { id: 'ap', team_id: 'especializado', name: 'Ana Júlia', identity_role: 'apprentice' },
]
const base = {
  ticket_id: '1052494',
  ticket_created_at: '2026-10-03T14:41:21Z',
  messages: [{ id: 2596142, created_at: '2026-10-03T14:44:05Z', author_type: 'agent', visibility: 'public', author: 'João Vitor Almeida' }],
  events: [{ id: 18202, created_at: '2026-10-03T14:42:36Z', field: 'department', new: 'Suporte - ERP' }],
  analysts,
}
test('captures verified public human response on local day', () => {
  const result = captureFirstHumanAttendance(base)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.human_answered_date, '2026-10-03')
    assert.equal(result.value.ticket_created_date, '2026-10-03')
    assert.equal(result.value.analyst_id, 'jv')
    assert.equal(result.value.area_at_answer, 'Suporte - ERP')
  }
})
test('carryover is credited to first human response day, not ticket creation', () => {
  const result = captureFirstHumanAttendance({ ...base, messages: [{ ...base.messages[0], created_at: '2026-10-05T11:45:43Z' }] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.ticket_created_date, '2026-10-03')
    assert.equal(result.value.human_answered_date, '2026-10-05')
  }
})
test('rejects private messages and ownership without public answer', () => {
  assert.deepEqual(captureFirstHumanAttendance({ ...base, messages: [{ ...base.messages[0], visibility: 'private' }] }), { ok: false, reason: 'no_public_human_message' })
})
test('rejects apprentice even when public answer exists', () => {
  const result = captureFirstHumanAttendance({ ...base, messages: [{ ...base.messages[0], author: 'Ana Júlia' }] })
  assert.deepEqual(result, { ok: false, reason: 'unconfirmed_or_ambiguous_analyst' })
})
test('rejects ambiguous authors', () => {
  const result = captureFirstHumanAttendance({ ...base, analysts: [...analysts, { id: 'dup', team_id: 'outros', name: 'João Vitor Almeida', identity_role: 'analyst' }] })
  assert.deepEqual(result, { ok: false, reason: 'unconfirmed_or_ambiguous_analyst' })
})
test('credits verified human attendance without historical department events', () => {
  const result = captureFirstHumanAttendance({ ...base, events: [] })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.analyst_id, 'jv')
    assert.equal(result.value.area_at_answer, null)
    assert.equal(result.value.department_event_id, null)
  }
})
test('source queue does not block a verified human reply', () => {
  const result = captureFirstHumanAttendance({ ...base,
    events: [{ id: 34, created_at: '2026-10-03T14:42:36Z', field: 'department', new: 'Comercial' }],
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.analyst_id, 'jv')
})
test('selects historical department at answer, not later transfer', () => {
  const result = captureFirstHumanAttendance({ ...base, events: [...base.events, { id: 999, created_at: '2026-10-03T15:00:00Z', field: 'department', new: 'Suporte - Fiscal' }] })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.area_at_answer, 'Suporte - ERP')
})
test('first public human message determines author', () => {
  const result = captureFirstHumanAttendance({ ...base, messages: [
    { id: 1, created_at: '2026-10-03T14:42:00Z', author_type: 'agent', visibility: 'private', author: 'Thiago Reis' },
    ...base.messages,
    { id: 2, created_at: '2026-10-03T14:50:00Z', author_type: 'agent', visibility: 'public', author: 'Thiago Reis' },
  ] })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.analyst_id, 'jv')
})
test('requires absolute timestamps', () => {
  const result = captureFirstHumanAttendance({ ...base, messages: [{ ...base.messages[0], created_at: '2026-10-03T14:44:05' }] })
  assert.deepEqual(result, { ok: false, reason: 'no_public_human_message' })
})

test('credits registered analyst after prior public answer from Comercial', () => {
  const messages = [
    { id: 33, created_at: '2026-10-03T14:42:00Z', author_type: 'agent', visibility: 'public', author: 'Agente Comercial' },
    ...base.messages,
  ]
  const result = captureFirstHumanAttendance({ ...base, messages })
  assert.equal(result.ok,true)
  if (result.ok) {
    assert.equal(result.value.analyst_id,'jv')
    assert.equal(result.value.first_public_human_message_id,'2596142')
  }
})
test('does not award an apprentice but credits subsequent qualified analyst', () => {
  const messages = [
    { id: 36, created_at: '2026-10-03T14:42:00Z', author_type: 'agent', visibility: 'public', author: 'Ana Júlia' },
    ...base.messages,
  ]
  const result = captureFirstHumanAttendance({ ...base, messages })
  assert.equal(result.ok,true)
  if (result.ok) assert.equal(result.value.analyst_id,'jv')
})

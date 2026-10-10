import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractRestRecords, normalizeRestMessage, normalizeRestEvent, unwrapRestTicket,
} from '../src/lib/clickdesk-rest-evidence.ts'
import { captureFirstHumanAttendance } from '../src/lib/clickdesk-human-capture.ts'
import { buildTicketProductivityEvidence } from '../src/lib/clickdesk-ticket-productivity.ts'

test('reads nested ClickDesk REST collection without silently returning empty', () => {
  assert.deepEqual(extractRestRecords({ data: { data: [{ id: '34' }] } }), [{ id: '34' }])
  assert.deepEqual(extractRestRecords({ data: [{ id: 2 }] }), [{ id: 2 }])
  assert.throws(() => extractRestRecords({ data: { total: 22 } }), /coleção ausente/)
})

test('accepts explicitly public human answer from nested author and safe timestamp', () => {
  const m = normalizeRestMessage({
    id: 3489019, timestamp: '2026-10-08T20:43:04.000000Z',
    author: { name: 'Diego Machado', type: 'agent' },
    visibility: 'public',
  })
  assert.deepEqual(m, {
    id: '3489019', created_at: '2026-10-08T20:43:04.000000Z',
    author_type: 'agent', visibility: 'public', author: 'Diego Machado',
  })
  assert.equal(normalizeRestMessage({ id: 7, author: 'João Vitor', author_type: 'agent', is_public: false }).visibility, 'private')
  assert.equal(normalizeRestMessage({ id: 7, author: 'João Vitor', author_type: 'agent' }).visibility, '')
})

test('normalizes department changes from REST to but does not require originating queue', () => {
  assert.deepEqual(normalizeRestEvent({
    id: 47337, timestamp: '2026-10-08T20:42:40+00:00',
    field: 'department', to: 'Comercial',
  }), {
    id: '47337', created_at: '2026-10-08T20:42:40+00:00',
    field: 'department', new: 'Comercial',
  })
})

test('produces ticket, verified human author and explicit rating regardless of source area', () => {
  const ticket = unwrapRestTicket({ data: {
    id: 1057924, created_at: '2026-10-08T20:42:03.000000Z',
    satisfaction: { label: 'Boa' }, status: 'closed',
  } })
  const decision = captureFirstHumanAttendance({
    ticket_id: String(ticket.id), ticket_created_at: String(ticket.created_at),
    messages: extractRestRecords({ data: { messages: [
      { id: 3489019, created_at: '2026-10-08T20:43:04.000000Z', author_type: 'agent', author: 'Diego Machado', visibility: 'public' },
    ] } }).map(normalizeRestMessage),
    events: [normalizeRestEvent({ id: 47337, created_at: '2026-10-08T20:42:40+00:00', field: 'department', to: 'Comercial' })],
    analysts: [{ id: 'diego', team_id: 'outros', name: 'Diego Machado', identity_role: 'analyst' }],
  })
  assert.equal(decision.ok, true)
  if (decision.ok) assert.deepEqual(
    buildTicketProductivityEvidence(decision.value, ticket),
    {
      ticket_id: '1057924', analyst_id: 'diego', analyst_name: 'Diego Machado',
      human_answered_date: '2026-10-08', first_public_human_message_id: '3489019',
      satisfaction_label: 'positive', verification: 'public_human_author',
    },
  )
})

test('does not count private replies or unknown authors and does not infer rating', () => {
  const analyst = { id: 'carlos', team_id: 'especializado', name: 'Carlos Lemos', identity_role: 'analyst' }
  const base = {
    ticket_id: '1057926', ticket_created_at: '2026-10-08T15:00:00Z',
    events: [], analysts: [analyst],
  }
  const privateResult = captureFirstHumanAttendance({
    ...base, messages: [normalizeRestMessage({ id: 1, created_at: '2026-10-08T15:10:00Z', author: 'Carlos Lemos', author_type: 'agent', visibility: 'private' })],
  })
  assert.equal(privateResult.ok, false)
  const unknownResult = captureFirstHumanAttendance({
    ...base, messages: [normalizeRestMessage({ id: 2, created_at: '2026-10-08T15:10:00Z', author: 'Outra pessoa', author_type: 'agent', visibility: 'public' })],
  })
  assert.equal(unknownResult.ok, false)
})

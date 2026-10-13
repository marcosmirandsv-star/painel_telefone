import test from 'node:test'
import assert from 'node:assert/strict'
import { selectVerifiedQualitativeTicket } from '../src/lib/clickdesk-qualitative-lookup.ts'

const ticket = {
  ticket_id: '1058500',
  analyst_id: 'vanessa-id',
  occurred_date: '2026-10-09',
  satisfaction_label: 'positive',
}

test('verified capture can authorize a recovered analyst ticket', () => {
  const result = selectVerifiedQualitativeTicket('1058500', [ticket], false, 'vanessa-id')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.ticket.clickdesk_ticket_id, '1058500')
    assert.equal(result.ticket.analyst_id, 'vanessa-id')
    assert.equal(result.ticket.satisfaction_label, 'positive')
  }
})

test('analyst cannot access another analyst contribution by ticket ID', () => {
  const result = selectVerifiedQualitativeTicket('1058500', [ticket], false, 'other-analyst')
  assert.deepEqual([result.ok, result.ok ? null : result.status], [false, 404])
})

test('session without analyst link cannot access verified tickets', () => {
  const result = selectVerifiedQualitativeTicket('1058500', [ticket], false, null)
  assert.deepEqual([result.ok, result.ok ? null : result.status], [false, 403])
})

test('rejects rows from another ticket', () => {
  const result = selectVerifiedQualitativeTicket('1059317', [ticket], false, 'vanessa-id')
  assert.deepEqual([result.ok, result.ok ? null : result.status], [false, 404])
})

test('management cannot silently attribute a multi-agent ticket to one analyst', () => {
  const result = selectVerifiedQualitativeTicket(
    '1058500',
    [ticket, { ...ticket, analyst_id: 'other-analyst' }],
    true,
    null,
  )
  assert.deepEqual([result.ok, result.ok ? null : result.status], [false, 422])
})

test('rejects a verified record with no human analyst', () => {
  const result = selectVerifiedQualitativeTicket(
    '1058500',
    [{ ...ticket, analyst_id: null }],
    true,
    null,
  )
  assert.deepEqual([result.ok, result.ok ? null : result.status], [false, 422])
})

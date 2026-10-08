import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTicketSatisfaction } from '../src/lib/clickdesk-ticket-productivity.ts'

test('ratings are binary only when explicit', () => {
 assert.equal(normalizeTicketSatisfaction({label:'Boa'}),'positive')
 assert.equal(normalizeTicketSatisfaction({label:'Ruim'}),'negative')
 assert.equal(normalizeTicketSatisfaction({sentiment:'negative'}),'negative')
 assert.equal(normalizeTicketSatisfaction({offered:true} ),null)
})

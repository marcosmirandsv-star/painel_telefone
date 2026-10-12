import test from 'node:test'
import assert from 'node:assert/strict'
import { isExcludedApprentice, summarizeOfficialResolutions } from '../src/lib/clickdesk-official-resolutions.ts'

const input = [
  { resolved_date:'2026-10-07',analyst_id:'carlos',team_id:'especializado',assignee_name:'Carlos Lemos',area:'Suporte - Fiscal',resolved_count:26,source:'clickdesk_support_reports_agents',updated_at:'2026-10-07T22:00:00Z' },
  { resolved_date:'2026-10-08',analyst_id:'carlos',team_id:'especializado',assignee_name:'Carlos Lemos',area:'Suporte - Fiscal',resolved_count:14,source:'clickdesk_support_reports_agents',updated_at:'2026-10-08T20:00:00Z' },
  { resolved_date:'2026-10-08',analyst_id:'jv',team_id:'especializado',assignee_name:'João Vitor Almeida',area:'Suporte - ERP',resolved_count:7,source:'clickdesk_support_reports_agents',updated_at:'2026-10-08T21:00:00Z' },
  { resolved_date:'2026-10-08',analyst_id:'ana',team_id:'especializado',assignee_name:'Ana Júlia',area:'Suporte - ERP',resolved_count:9,source:'clickdesk_support_reports_agents',updated_at:'2026-10-08T21:00:00Z' },
  { resolved_date:'2026-10-08',analyst_id:'david',team_id:'outros',assignee_name:'David Souza',area:'Suporte - ERP',resolved_count:3,source:'clickdesk_support_reports_agents',updated_at:'2026-10-08T21:00:00Z' },
] as const

test('official resolution totals are separate and apprentice work excluded', () => {
  const result = summarizeOfficialResolutions(input.map(x=>({...x})), '2026-10-08')
  assert.equal(result.total, 47)
  assert.equal(result.today.resolved, 21)
  assert.deepEqual(result.daily,[{date:'2026-10-07',resolved:26},{date:'2026-10-08',resolved:21}])
  assert.equal(result.by_analyst.length,2)
  assert.equal(result.by_analyst.find(r=>r.analyst_id==='carlos')?.total,40)
  assert.equal(result.by_analyst.find(r=>r.analyst_id==='carlos')?.today,14)
  assert.equal(result.last_updated_at,'2026-10-08T21:00:00Z')
})

test('source department does not change a known resolution', () => {
  const result = summarizeOfficialResolutions([{...input[0],area:'Comercial'}], '2026-10-08')
  assert.equal(result.total,26)
})

test('missing dates stay absent instead of being turned into zero-result days', () => {
  const result = summarizeOfficialResolutions([input[0]], '2026-10-08')
  assert.equal(result.daily.length,1)
  assert.equal(result.today.resolved,0)
  assert.equal(result.has_records,true)
})

test('unknown source and malformed counts are not used', () => {
  const result = summarizeOfficialResolutions([
    {...input[0],source:'guess'},
    {...input[0],resolved_count:-4},
    {...input[0],resolved_count:1.5},
  ],'2026-10-08')
  assert.equal(result.has_records,false)
  assert.equal(result.total,0)
})

test('apprentices are excluded by name irrespective of diacritics', () => {
  assert.equal(isExcludedApprentice('Ana Júlia'),true)
  assert.equal(isExcludedApprentice('David Pereira'),true)
  assert.equal(isExcludedApprentice('Davidson'),false)
  assert.equal(isExcludedApprentice('Carlos Lemos'),false)
})

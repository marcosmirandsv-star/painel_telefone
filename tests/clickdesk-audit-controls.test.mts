import test from 'node:test'
import assert from 'node:assert/strict'
import { captureFirstHumanAttendance } from '../src/lib/clickdesk-human-capture.ts'

// Audit-derived reduced evidence fixtures, NOT a raw REST messages/events replay.
// This validates contract and totals; raw replay still requires original API payloads.
const rows = [
  {
    "ticket_id": "1052563",
    "ticket_created_at": "2026-10-03T21:23:09.000000Z",
    "first_public_human_message_id": 3424716,
    "author": "João Pedro Vianey",
    "analyst_id": "97f0071d-ae22-4d90-8c4d-1545e00b4a7d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-05T11:45:43.000000Z",
    "human_answered_date": "2026-10-05",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 18602
  },
  {
    "ticket_id": "1052559",
    "ticket_created_at": "2026-10-03T20:16:08.000000Z",
    "first_public_human_message_id": 3424775,
    "author": "Christian Matozinho",
    "analyst_id": "c763a2ae-f48d-4f3e-8912-333e425727bb",
    "team_id": "dc039139-7bec-4271-a27a-38a32959a892",
    "human_answered_at": "2026-10-05T11:48:47.000000Z",
    "human_answered_date": "2026-10-05",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18539
  },
  {
    "ticket_id": "1052499",
    "ticket_created_at": "2026-10-03T14:55:59.000000Z",
    "first_public_human_message_id": 3424902,
    "author": "Diego Machado",
    "analyst_id": "4d0735a2-cb66-4b54-94db-0f63e53e0a9e",
    "team_id": "dc039139-7bec-4271-a27a-38a32959a892",
    "human_answered_at": "2026-10-05T11:54:24.000000Z",
    "human_answered_date": "2026-10-05",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18234
  },
  {
    "ticket_id": "1052494",
    "ticket_created_at": "2026-10-03T14:41:21.000000Z",
    "first_public_human_message_id": 2596142,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:44:05.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18202
  },
  {
    "ticket_id": "1052493",
    "ticket_created_at": "2026-10-03T14:38:23.000000Z",
    "first_public_human_message_id": 2600317,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:45:18.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18192
  },
  {
    "ticket_id": "1052489",
    "ticket_created_at": "2026-10-03T14:31:25.000000Z",
    "first_public_human_message_id": 2563879,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:32:13.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18164
  },
  {
    "ticket_id": "1052481",
    "ticket_created_at": "2026-10-03T14:18:25.000000Z",
    "first_public_human_message_id": 2531293,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:20:00.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 18123
  },
  {
    "ticket_id": "1052476",
    "ticket_created_at": "2026-10-03T14:11:56.000000Z",
    "first_public_human_message_id": 2559386,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:30:29.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 18152
  },
  {
    "ticket_id": "1052473",
    "ticket_created_at": "2026-10-03T14:06:40.000000Z",
    "first_public_human_message_id": 2515745,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T14:12:19.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 18091
  },
  {
    "ticket_id": "1052460",
    "ticket_created_at": "2026-10-03T13:28:29.000000Z",
    "first_public_human_message_id": 2436633,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T13:32:48.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 18018
  },
  {
    "ticket_id": "1052445",
    "ticket_created_at": "2026-10-03T12:52:05.000000Z",
    "first_public_human_message_id": 2371034,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T13:01:48.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 17929
  },
  {
    "ticket_id": "1052444",
    "ticket_created_at": "2026-10-03T12:50:14.000000Z",
    "first_public_human_message_id": 2366489,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T13:00:02.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 17948
  },
  {
    "ticket_id": "1052430",
    "ticket_created_at": "2026-10-03T12:14:29.000000Z",
    "first_public_human_message_id": 2268535,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T12:18:56.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 17857
  },
  {
    "ticket_id": "1052426",
    "ticket_created_at": "2026-10-03T12:02:22.000000Z",
    "first_public_human_message_id": 2241679,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T12:07:22.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 17832
  },
  {
    "ticket_id": "1052423",
    "ticket_created_at": "2026-10-03T11:59:36.000000Z",
    "first_public_human_message_id": 2229318,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T12:01:41.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - Fiscal",
    "department_event_id": 17817
  },
  {
    "ticket_id": "1052420",
    "ticket_created_at": "2026-10-03T11:53:11.000000Z",
    "first_public_human_message_id": 2219460,
    "author": "João Vitor Almeida",
    "analyst_id": "b25c82c0-50a7-473a-b69d-d49b359add6d",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T11:57:29.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 17807
  },
  {
    "ticket_id": "1052418",
    "ticket_created_at": "2026-10-03T11:43:42.000000Z",
    "first_public_human_message_id": 2252094,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T12:12:04.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 17842
  },
  {
    "ticket_id": "1052413",
    "ticket_created_at": "2026-10-03T11:35:03.000000Z",
    "first_public_human_message_id": 2182924,
    "author": "Thiago Reis",
    "analyst_id": "598d5aec-15c8-4504-85f7-4521c1a040fc",
    "team_id": "6a9ad22d-7c6f-48e0-98bc-60561dcc8008",
    "human_answered_at": "2026-10-03T11:41:39.000000Z",
    "human_answered_date": "2026-10-03",
    "area_at_answer": "Suporte - ERP",
    "department_event_id": 17758
  }
]

test('18 audit-derived controls: dates, author, department and unique tickets', () => {
 const analysts = [...new Map(rows.map(r => [r.analyst_id, {id:r.analyst_id,team_id:r.team_id,name:r.author,identity_role:'analyst'}])).values()]
 const captured = rows.map(r => {
  const actual = captureFirstHumanAttendance({
   ticket_id:r.ticket_id,ticket_created_at:r.ticket_created_at,analysts,
   messages:[{id:r.first_public_human_message_id,created_at:r.human_answered_at,author_type:'agent',visibility:'public',author:r.author}],
   events:[{id:r.department_event_id,created_at:r.ticket_created_at,field:'department',new:r.area_at_answer}],
  })
  assert.equal(actual.ok,true,`ticket ${r.ticket_id}`)
  if (!actual.ok) return null
  assert.equal(actual.value.analyst_id,r.analyst_id)
  assert.equal(actual.value.human_answered_date,r.human_answered_date)
  assert.equal(actual.value.area_at_answer,r.area_at_answer)
  return actual.value
 }).filter(v=>v!==null)
 assert.equal(captured.length,18)
 assert.equal(new Set(captured.map(r=>r.ticket_id)).size,18)
 const on3=captured.filter(r=>r.human_answered_date==='2026-10-03')
 assert.equal(on3.length,15)
 assert.equal(on3.filter(r=>r.author==='João Vitor Almeida').length,6)
 assert.equal(on3.filter(r=>r.author==='Thiago Reis').length,9)
 assert.equal(on3.filter(r=>r.area_at_answer==='Suporte - ERP').length,9)
 assert.equal(on3.filter(r=>r.area_at_answer==='Suporte - Fiscal').length,6)
 assert.deepEqual(captured.filter(r=>r.human_answered_date==='2026-10-05').map(r=>r.ticket_id).sort(),['1052499','1052559','1052563'])
})

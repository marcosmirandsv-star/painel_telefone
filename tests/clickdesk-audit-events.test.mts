import test from 'node:test'
import assert from 'node:assert/strict'
import {captureFirstHumanAttendance} from '../src/lib/clickdesk-human-capture.ts'

// Historical department/owner/status events are copied from the read-only REST diagnostic.
// First public messages are reconstructed from the audit's confirmed message metadata;
// this is NOT a full replay of the original messages endpoint.
const cases = [
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
    "department_event_id": 18602,
    "events": [
      {
        "id": 18602,
        "created_at": "2026-10-03T21:29:38+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 19462,
        "created_at": "2026-10-05T11:45:11+00:00",
        "field": "owner",
        "new": "João Pedro Vianey"
      },
      {
        "id": 19464,
        "created_at": "2026-10-05T11:45:46+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18539,
    "events": [
      {
        "id": 18539,
        "created_at": "2026-10-03T20:19:57+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 19488,
        "created_at": "2026-10-05T11:46:55+00:00",
        "field": "owner",
        "new": "Christian Matozinho"
      },
      {
        "id": 19600,
        "created_at": "2026-10-05T11:54:32+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18234,
    "events": [
      {
        "id": 18234,
        "created_at": "2026-10-03T14:56:55+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 19472,
        "created_at": "2026-10-05T11:46:22+00:00",
        "field": "owner",
        "new": "Diego Machado"
      },
      {
        "id": 19717,
        "created_at": "2026-10-05T12:01:47+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18202,
    "events": [
      {
        "id": 18202,
        "created_at": "2026-10-03T14:42:36+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 18204,
        "created_at": "2026-10-03T14:42:55+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 18216,
        "created_at": "2026-10-03T14:49:34+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18192,
    "events": [
      {
        "id": 18192,
        "created_at": "2026-10-03T14:38:48+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 18196,
        "created_at": "2026-10-03T14:39:55+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18214,
        "created_at": "2026-10-03T14:49:03+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18164,
    "events": [
      {
        "id": 18164,
        "created_at": "2026-10-03T14:31:32+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 18165,
        "created_at": "2026-10-03T14:31:44+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18209,
        "created_at": "2026-10-03T14:45:43+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18123,
    "events": [
      {
        "id": 18123,
        "created_at": "2026-10-03T14:19:32+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 18124,
        "created_at": "2026-10-03T14:19:39+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18194,
        "created_at": "2026-10-03T14:39:24+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18152,
    "events": [
      {
        "id": 18152,
        "created_at": "2026-10-03T14:26:05+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 18160,
        "created_at": "2026-10-03T14:29:34+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 18181,
        "created_at": "2026-10-03T14:35:11+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18091,
    "events": [
      {
        "id": 18091,
        "created_at": "2026-10-03T14:11:20+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 18092,
        "created_at": "2026-10-03T14:11:40+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18195,
        "created_at": "2026-10-03T14:39:50+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 18018,
    "events": [
      {
        "id": 18018,
        "created_at": "2026-10-03T13:31:14+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 18019,
        "created_at": "2026-10-03T13:31:20+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 18050,
        "created_at": "2026-10-03T13:51:09+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17929,
    "events": [
      {
        "id": 17929,
        "created_at": "2026-10-03T12:52:33+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 17932,
        "created_at": "2026-10-03T12:54:53+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 17967,
        "created_at": "2026-10-03T13:06:48+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17948,
    "events": [
      {
        "id": 17948,
        "created_at": "2026-10-03T12:59:38+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 17949,
        "created_at": "2026-10-03T12:59:51+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18066,
        "created_at": "2026-10-03T14:04:21+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17857,
    "events": [
      {
        "id": 17857,
        "created_at": "2026-10-03T12:15:50+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 17859,
        "created_at": "2026-10-03T12:17:41+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 17875,
        "created_at": "2026-10-03T12:26:19+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17832,
    "events": [
      {
        "id": 17832,
        "created_at": "2026-10-03T12:03:56+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 17836,
        "created_at": "2026-10-03T12:07:05+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 17861,
        "created_at": "2026-10-03T12:19:45+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17817,
    "events": [
      {
        "id": 17817,
        "created_at": "2026-10-03T12:00:42+00:00",
        "field": "department",
        "new": "Suporte - Fiscal"
      },
      {
        "id": 17819,
        "created_at": "2026-10-03T12:01:10+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 17839,
        "created_at": "2026-10-03T12:08:03+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17807,
    "events": [
      {
        "id": 17807,
        "created_at": "2026-10-03T11:56:05+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 17809,
        "created_at": "2026-10-03T11:57:22+00:00",
        "field": "owner",
        "new": "João Vitor Almeida"
      },
      {
        "id": 17826,
        "created_at": "2026-10-03T12:01:56+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17842,
    "events": [
      {
        "id": 17842,
        "created_at": "2026-10-03T12:10:53+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 17846,
        "created_at": "2026-10-03T12:11:36+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 18005,
        "created_at": "2026-10-03T13:26:35+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
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
    "department_event_id": 17758,
    "events": [
      {
        "id": 17758,
        "created_at": "2026-10-03T11:36:15+00:00",
        "field": "department",
        "new": "Suporte - ERP"
      },
      {
        "id": 17772,
        "created_at": "2026-10-03T11:40:31+00:00",
        "field": "owner",
        "new": "Thiago Reis"
      },
      {
        "id": 17816,
        "created_at": "2026-10-03T12:00:37+00:00",
        "field": "status",
        "new": "Resolvido"
      }
    ]
  }
]

test('18 controls with actual historical events and audited first-message metadata', () => {
 const analysts=[...new Map(cases.map(r=>[r.analyst_id,{id:r.analyst_id,team_id:r.team_id,name:r.author,identity_role:'analyst'}])).values()]
 const outputs=cases.map(r=>{
  const decision=captureFirstHumanAttendance({ticket_id:r.ticket_id,ticket_created_at:r.ticket_created_at,analysts,events:r.events,messages:[{id:r.first_public_human_message_id,created_at:r.human_answered_at,author_type:'agent',visibility:'public',author:r.author}]})
  assert.equal(decision.ok,true,`ticket ${r.ticket_id}: ${decision.ok?'':decision.reason}`)
  if(!decision.ok) return null
  assert.equal(decision.value.department_event_id,String(r.department_event_id))
  assert.equal(decision.value.area_at_answer,r.area_at_answer)
  assert.equal(decision.value.human_answered_date,r.human_answered_date)
  assert.equal(decision.value.analyst_id,r.analyst_id)
  return decision.value
 }).filter(x=>x!==null)
 assert.equal(outputs.length,18)
 assert.equal(new Set(outputs.map(x=>x.ticket_id)).size,18)
 assert.equal(outputs.filter(x=>x.human_answered_date==='2026-10-03').length,15)
 assert.equal(outputs.filter(x=>x.human_answered_date==='2026-10-05').length,3)
})

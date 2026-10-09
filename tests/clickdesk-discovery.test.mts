import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PAGE_SIZE, clickdeskDiscoveryPath, extractClickdeskRows, ticketDiscoveryLastPage,
} from '../supabase/functions/clickdesk-d1-sync/discovery.ts'

test('uses the verified ClickDesk team-stage REST ticket listing without AI-origin requirements', () => {
  assert.equal(PAGE_SIZE, 500)
  assert.equal(clickdeskDiscoveryPath(1),
    '/tickets?inbox=all&view=all&stage=team&sort=id&dir=desc&per_page=500&page=1')
  assert.equal(clickdeskDiscoveryPath(20),
    '/tickets?inbox=all&view=all&stage=team&sort=id&dir=desc&per_page=500&page=20')
  assert.throws(() => clickdeskDiscoveryPath(0), /Invalid/)
  assert.throws(() => clickdeskDiscoveryPath(1.5), /Invalid/)
})

test('reads 500-ticket collection and known pagination envelope', () => {
  const tickets = Array.from({length:500}, (_,i)=>({id:String(1058000+i),updated_at:'2026-10-09T13:00:00Z'}))
  const payload = {data:{data:tickets},meta:{last_page:20,current_page:1,per_page:500}}
  assert.equal(extractClickdeskRows(payload).length,500)
  assert.equal(ticketDiscoveryLastPage(payload),20)
  assert.equal(ticketDiscoveryLastPage({last_page:'20',data:tickets}),20)
})

test('does not misreport failed parsing or absent pagination as no tickets', () => {
  assert.deepEqual(extractClickdeskRows({data:{data:[]}}),[])
  assert.throws(()=>extractClickdeskRows({data:{total:500}}),/Unrecognized/)
  assert.throws(()=>ticketDiscoveryLastPage({data:[]}),/Missing/)
  assert.throws(()=>ticketDiscoveryLastPage({meta:{last_page:0},data:[]}),/Missing/)
})

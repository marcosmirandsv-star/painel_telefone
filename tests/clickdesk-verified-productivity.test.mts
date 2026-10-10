import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeVerifiedContributions, type VerifiedContributionRow } from '../src/lib/clickdesk-verified-productivity.ts'

const rows=[
 {ticket_id:'1',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-07',verified_at:'2026-10-09T15:30:00Z'},
 {ticket_id:'1',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-07',verified_at:'2026-10-09T15:30:00Z'},
 {ticket_id:'1',analyst_id:'paulo',team_id:'notas',analyst_name:'Paulo Victor',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:33:00Z'},
 {ticket_id:'2',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:34:00Z'},
 {ticket_id:'3',analyst_id:'ana',team_id:'notas',analyst_name:'Ana Júlia',occurred_date:'2026-10-08',verified_at:'2026-10-09T15:34:00Z'},
]
test('one attendance per ticket and human analyst; separate analysts each get their own real activity',()=>{
 const summary=summarizeVerifiedContributions(rows,'2026-10-08')
 assert.equal(summary.total,3)
 assert.deepEqual(summary.daily,[{date:'2026-10-07',count:1},{date:'2026-10-08',count:2}])
 assert.equal(summary.by_analyst.find(x=>x.analyst_id==='carlos')?.total,2)
 assert.equal(summary.by_analyst.find(x=>x.analyst_id==='paulo')?.total,1)
 assert.equal(summary.by_analyst.some(x=>x.analyst_id==='ana'),false)
 assert.equal(summary.last_verified_at,'2026-10-09T15:34:00Z')
})
test('missing dates are absent, never invented as zero attendance',()=>{
 const summary=summarizeVerifiedContributions(rows.slice(0,1),'2026-10-09')
 assert.equal(summary.today.count,0)
 assert.equal(summary.daily.length,1)
 assert.equal(summary.coverage_status,'partial_until_queue_finished')
})

test('verified customer satisfaction belongs only to the final human and never duplicates a ticket',()=>{
 const source:VerifiedContributionRow[]=[
  {...rows[0],satisfaction_label:null},
  {...rows[0],satisfaction_label:null},
  {...rows[2],satisfaction_label:'positive'},
  {...rows[3],satisfaction_label:'negative'},
  {...rows[4],satisfaction_label:'positive'},
 ]
 const summary=summarizeVerifiedContributions(source,'2026-10-08')
 assert.deepEqual(summary.evaluations,{
  positive_reviews:1,negative_reviews:1,reviews:2,csat:50,review_percentage:66.67,
 })
 assert.deepEqual(summary.by_analyst.find(x=>x.analyst_id==='carlos')?.evaluations,{
  positive_reviews:0,negative_reviews:1,reviews:1,csat:0,review_percentage:50,
 })
 assert.deepEqual(summary.by_analyst.find(x=>x.analyst_id==='paulo')?.evaluations,{
  positive_reviews:1,negative_reviews:0,reviews:1,csat:100,review_percentage:100,
 })
 assert.equal(summary.evaluations.reviews,2)
})

test('ended human work without customer review counts as attendance and not CSAT failure', () => {
 const summary=summarizeVerifiedContributions([
  {ticket_id:'unrated1',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',
   occurred_date:'2026-10-08',verified_at:'2026-10-09T15:00:00Z',satisfaction_label:null},
  {ticket_id:'unrated2',analyst_id:'carlos',team_id:'notas',analyst_name:'Carlos Lemos',
   occurred_date:'2026-10-08',verified_at:'2026-10-09T15:01:00Z',satisfaction_label:null},
 ], '2026-10-08')
 assert.equal(summary.total,2)
 assert.deepEqual(summary.evaluations,{
  positive_reviews:0,negative_reviews:0,reviews:0,csat:null,review_percentage:0,
 })
 assert.deepEqual(summary.by_analyst[0]?.ratings_daily,[{
  date:'2026-10-08',positive_reviews:0,negative_reviews:0,reviews:0,
  csat:null,review_percentage:0,
 }])
 assert.deepEqual(summary.ratings_daily,summary.by_analyst[0]?.ratings_daily)
})
test('day-by-day evaluation totals follow the credited analyst service day', () => {
 const sample:VerifiedContributionRow[]=[
  {ticket_id:'first',analyst_id:'a',team_id:'t',analyst_name:'Paulo Victor',
   occurred_date:'2026-10-07',verified_at:null,satisfaction_label:'positive'},
  {ticket_id:'second',analyst_id:'a',team_id:'t',analyst_name:'Paulo Victor',
   occurred_date:'2026-10-07',verified_at:null,satisfaction_label:null},
  {ticket_id:'third',analyst_id:'a',team_id:'t',analyst_name:'Paulo Victor',
   occurred_date:'2026-10-08',verified_at:null,satisfaction_label:'negative'},
 ]
 const summary=summarizeVerifiedContributions(sample,'2026-10-08')
 assert.deepEqual(summary.by_analyst[0]?.ratings_daily,[
  {date:'2026-10-07',positive_reviews:1,negative_reviews:0,reviews:1,csat:100,review_percentage:50},
  {date:'2026-10-08',positive_reviews:0,negative_reviews:1,reviews:1,csat:0,review_percentage:100},
 ])
})
test('repeated unreviewed row cannot obscure a reviewed contribution', () => {
 const original:VerifiedContributionRow={ticket_id:'one',analyst_id:'a',team_id:'t',analyst_name:'Carlos Lemos',
 occurred_date:'2026-10-07',verified_at:null,satisfaction_label:null}
 const summary=summarizeVerifiedContributions([original,{...original,satisfaction_label:'positive'}],'2026-10-07')
 assert.equal(summary.total,1)
 assert.equal(summary.evaluations.reviews,1)
 assert.equal(summary.by_analyst[0]?.evaluations.csat,100)
})

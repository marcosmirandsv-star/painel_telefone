import test from 'node:test'
import assert from 'node:assert/strict'
import {chatMetricTotals} from '../src/lib/chat-metric-totals.ts'
test('external neutral changes only adjusted CSAT; participation retains every original vote',()=>{
 const totals=chatMetricTotals([{attendances:100,positive_reviews:20,negative_reviews:5,excluded_neutrals:2,neutral_human:1,neutral_external:2,neutral_pending:2}])
 assert.equal(totals.csat_original,80);assert.equal(totals.csat,86.96);assert.equal(totals.reviews,25);assert.equal(totals.review_percentage,25)
 assert.equal(totals.negative_reviews,5);assert.equal(totals.neutral_pending,2)
})
test('team CSAT is weighted, with no fabricated zero or cap for cross-period ratings',()=>{
 const totals=chatMetricTotals([{attendances:10,positive_reviews:1,negative_reviews:0},{attendances:90,positive_reviews:9,negative_reviews:10}])
 assert.equal(totals.csat,50);assert.equal(totals.review_percentage,20)
 assert.equal(chatMetricTotals([]).csat,null)
 assert.equal(chatMetricTotals([{attendances:1,positive_reviews:2,negative_reviews:0}]).review_percentage,200)
 assert.throws(()=>chatMetricTotals([{attendances:1,positive_reviews:0,negative_reviews:1,excluded_neutrals:2}]))
})

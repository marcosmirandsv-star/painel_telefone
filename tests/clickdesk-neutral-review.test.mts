import test from 'node:test'
import assert from 'node:assert/strict'
import {validateNeutralAttribution} from '../src/lib/clickdesk-neutral-review.ts'
const transcript='Cliente: a sincronização apresentou erro novamente. Analista: registrei a falha e combinei retorno amanhã.'
const input={cause:'system',confidence:'high',human_contribution:false,explanation:'O cliente relata erro de sincronização e o analista registra a falha com retorno combinado.',evidence_quotes:['a sincronização apresentou erro novamente.'],pattern:'none'}
test('neutro externo exige evidência literal, confiança alta e ausência de contribuição humana',()=>{
 assert.equal(validateNeutralAttribution(input,transcript).exclusion_eligible,true)
 for(const mutation of [{human_contribution:true},{confidence:'low'},{evidence_quotes:['Uma frase que não está no transcript.']},{cause:'mixed'}])assert.equal(validateNeutralAttribution({...input,...mutation},transcript).exclusion_eligible,false)
})
test('contradictory human attribution and excess quotes remain inconclusive',()=>{
 assert.equal(validateNeutralAttribution({...input,cause:'human'},transcript).cause,'inconclusive')
 assert.equal(validateNeutralAttribution({...input,evidence_quotes:Array(4).fill(input.evidence_quotes[0])},transcript).exclusion_eligible,false)
 assert.equal(validateNeutralAttribution({...input,cause:'mixed',human_contribution:true},transcript).cause,'mixed')
})

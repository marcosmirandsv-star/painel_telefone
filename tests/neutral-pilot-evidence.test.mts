import {test} from 'node:test'
import assert from 'node:assert/strict'
import {preparePilotEvidence,validatePilotAssessment,combinePilotAssessments} from '../src/lib/neutral-pilot/pilot-evidence.ts'

const own = {id:'1',created_at:'2026-11-14T10:19:00-03:00',author:{name:'Thiago Reis',type:'agent'},visibility:'public',body:'Vou verificar o erro do sistema e retornar com os detalhes.'}
const other = {...own,id:'2',author:{name:'Outra Pessoa',type:'agent'},body:'Foi confirmada uma indisponibilidade na integração fiscal.'}
const args = {messages:[own,other],ratedAt:'2026-11-14T13:20:00Z',analystName:'Thiago Reis',historyComplete:true}
const prepared = preparePilotEvidence(args)
const human = {cause:'human',confidence:'high',human_contribution:true,explanation:'A leitura deve se apoiar em uma conduta explícita e contextualizada.',evidences:[{message_id:'1',quote:own.body}]}
const system = {...human,cause:'system',human_contribution:false,evidences:[{message_id:'2',quote:other.body}]}

test('valid complete evidence enables caller and converts dates',()=>{
  assert.equal(prepared.ready,true);assert.equal(prepared.shouldCallGemini,true)
  assert.equal(prepared.cutoff,'2026-11-14T13:20:00.000Z');assert.equal(prepared.messages.length,2)
})
test('excludes all messages in rating minute and later, even if seconds precede the rating',()=>{
  const result=preparePilotEvidence({...args,ratedAt:'2026-11-14T13:20:55Z',messages:[own,{...other,id:'3',created_at:'2026-11-14T13:20:01Z'},{...other,id:'4',created_at:'2026-11-14T13:21:00Z'}]})
  assert.deepEqual(result.messages.map(m=>m.id),['1'])
})
test('incomplete or missing history cannot call Gemini',()=>{
  for(const result of [preparePilotEvidence({...args,historyComplete:false}),preparePilotEvidence({...args,messages:null}),preparePilotEvidence({...args,messages:[]})]){
    assert.equal(result.ready,false);assert.equal(result.shouldCallGemini,false)
  }
})
test('invalid dates and timestamps without timezone are gaps',()=>{
  for(const value of ['invalid','2026-11-14T13:19:00'])assert.ok(preparePilotEvidence({...args,messages:[{...own,created_at:value}]}).gaps.includes('message_timestamp_invalid'))
  assert.equal(preparePilotEvidence({...args,ratedAt:'invalid'}).ready,false)
})
test('duplicate IDs reject even identical duplicates',()=>{
  assert.ok(preparePilotEvidence({...args,messages:[own,own]}).gaps.includes('duplicate_message_id'))
})
test('pre-rating attachment requires separate verified inspection',()=>{
  const messages=[{...own,attachments:[{id:42}]}]
  assert.ok(preparePilotEvidence({...args,messages}).gaps.includes('attachment_uninspected'))
  assert.equal(preparePilotEvidence({...args,messages,verifiedAttachmentIds:['42']}).ready,true)
  const later={...other,id:'3',created_at:'2026-11-14T13:21:00Z',attachments:[{id:43}]}
  assert.equal(preparePilotEvidence({...args,messages:[own,later]}).ready,true)
})
test('unknown visibility and missing author reject evidence preparation',()=>{
  assert.equal(preparePilotEvidence({...args,messages:[{...own,visibility:undefined}]}).ready,false)
  assert.equal(preparePilotEvidence({...args,messages:[{...own,author:null}]}).ready,false)
})
test('only internal or another analyst messages do not prove assessed analyst participation',()=>{
  for(const messages of [[{...own,visibility:'internal'}],[other]])assert.ok(preparePilotEvidence({...args,messages}).gaps.includes('own_public_message_before_rating_missing'))
})
test('references are per-message, not arbitrary transcript substring',()=>{
  assert.equal(validatePilotAssessment(human,prepared).cause,'human')
  for(const evidences of [[{message_id:'2',quote:own.body}],[{message_id:'missing',quote:own.body}],[{message_id:'1',quote:'Uma frase inventada que não existe na mensagem'}]]){
    assert.equal(validatePilotAssessment({...human,evidences},prepared).cause,'inconclusive')
  }
})
test('human attribution requires own public evidence, internal and other-author context are insufficient',()=>{
  assert.equal(validatePilotAssessment({...human,evidences:system.evidences},prepared).cause,'inconclusive')
  const internal=preparePilotEvidence({...args,messages:[own,{...other,id:'3',author:own.author,visibility:'internal'}]})
  assert.equal(validatePilotAssessment({...human,evidences:[{message_id:'3',quote:other.body}]},internal).cause,'inconclusive')
})
test('pilot never permits exclusion or pattern labels, including external agreement',()=>{
  const first=validatePilotAssessment({...system,exclusion_eligible:true,pattern:'premature_closure'},prepared)
  const final=combinePilotAssessments(first,first)
  assert.equal(final.cause,'system');assert.equal(final.two_pass_agreement,true)
  assert.equal(final.exclusion_eligible,false);assert.equal(final.pattern,'none')
})
test('disagreement, low confidence, and malformed response remain inconclusive',()=>{
  const first=validatePilotAssessment(human,prepared),second=validatePilotAssessment(system,prepared)
  assert.equal(combinePilotAssessments(first,second).cause,'inconclusive')
  assert.equal(validatePilotAssessment({...human,confidence:'low'},prepared).cause,'inconclusive')
  assert.equal(validatePilotAssessment(null,prepared).cause,'inconclusive')
  assert.equal(validatePilotAssessment(human,{...prepared,ready:false}).cause,'inconclusive')
})


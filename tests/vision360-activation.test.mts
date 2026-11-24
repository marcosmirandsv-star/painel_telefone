import {combineReadings} from '../src/lib/vision360-activation/runner.ts'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readEvidence,runActivation,validateAnalysis,rejectFaultLanguage,evidenceCatalogue,evidenceBoundSchema,hydrateEvidenceReferences,safeProviderError,activationClaimPlan,type Work,type Store,record} from '../src/lib/vision360-activation/runner.ts'
const msg={id:'m1',created_at:'2026-11-17T18:38:00Z',author:{name:'Thiago Reis',type:'agent'},visibility:'public',body:'Verifiquei o retorno do sistema e expliquei os próximos passos.',attachments:[]}
const context={analystName:'Thiago Reis',ratedAt:'2026-11-17T18:39:00Z',area:'Fiscal',ledgerMatches:true}
const detail={id:'1098006',updated_at:'2026-11-17T19:00:00Z',messages:[msg]}
const get=async(path:string)=>path.endsWith('/messages')?{messages:[msg]}:path.endsWith('/events')?{events:[]}:detail
const generated={initial_sentiment:'unclear',final_sentiment:'unclear',primary_cause:{category:'system_or_product',summary:'Hipótese técnica sem comprovação causal.',confidence:'high'},human_influence:{classification:'improved',summary:'Explicou os próximos passos publicamente.',confidence:'medium'},controllability:{classification:'company',summary:'Contexto técnico.'},coaching_signal:{available:false,summary:'Manter explicação clara.'},analyst_takeaway:{kind:'maintain',summary:'Manter registro claro dos próximos passos.',confidence:'medium'},evidence_summary:['Explicação registrada.'],limitations:[],cx_coaching:{},evidence_refs:[{message_id:'m1',quote:msg.body,scope:'analyst_behavior'}]}
const env={CLICKDESK_API_KEY:'s-source',CLICKDESK_ACCOUNT_ID:'account',GEMINI_API_KEY:'s-provider',GEMINI_MODEL:'gemini-3.5-flash-lite'}
const work:Work={ticket_id:'1098006',analyst_id:'person',team_id:'team',occurred_date:'2026-11-17',satisfaction_label:'positive',attempts:1,lease_token:'lease'}
function store(){const saved:unknown[]=[],failed:string[]=[],claimed:string[]=[];const implementation:Store={claim:async id=>{claimed.push(id);return work},context:async()=>context,finish:async(_w,a)=>{saved.push(a);return true},fail:async(_w,c)=>{failed.push(c)}};return {implementation,saved,failed,claimed}}
function request(response:unknown={...generated,evidence_refs:[{reference_id:'E1',scope:'analyst_behavior'}]}){let provider=0;const fetchImpl=(async(input:URL|RequestInfo)=>{const url=String(input);if(url.includes('googleapis')){provider++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]})}return Response.json(await get(url.replace('https://api.desk.click.app/api/v1','')))}) as typeof fetch;return {fetchImpl,count:()=>provider}}
test('matching native snapshots allow explicitly partial public-behavior reading',async()=>{const evidence=await readEvidence('1098006',context,get);assert.deepEqual(evidence.gaps,[]);assert.equal(evidence.coverage.exhaustive,false);assert.equal(evidence.coverage.partial,true);assert.equal(evidence.coverage.mode,'snapshot_verified')})
test('changed source version blocks evidence',async()=>{let detailReads=0;const e=await readEvidence('1098006',context,async path=>{if(path.endsWith('/messages')||path.endsWith('/events'))return get(path);return {...detail,updated_at:++detailReads===1?detail.updated_at:'2026-11-17T19:01:00Z'}});assert.ok(e.gaps.includes('source_version_unverified'))})
test('missing rating timestamp, mismatched content and attachments block source',async()=>{const e=await readEvidence('1098006',{...context,ratedAt:''},async path=>path.endsWith('/messages')?{messages:[{...msg,body:'Different content',attachments:[{id:'file'}]}]}:get(path));assert.ok(e.gaps.includes('source_messages_not_corroborated'));assert.ok(e.gaps.includes('rating_timestamp_invalid'))})
test('same rating minute is not usable evidence',async()=>{const e=await readEvidence('1098006',{...context,ratedAt:'2026-11-17T18:38:59Z'},get);assert.ok(e.gaps.includes('own_public_message_before_rating_missing'))})
test('partial results force unclear cause, low confidence and no CSAT exclusion',async()=>{const e=await readEvidence('1098006',context,get);const a=validateAnalysis(generated,e.prepared,'positive');assert.equal(a._analysis_version,3);assert.equal(a.primary_cause.category,'unclear');assert.equal(a.primary_cause.confidence,'low');assert.equal(a.exclusion_eligible,false)})
test('bad quote or unknown id rejects and third-party author cannot prove behavior',async()=>{const e=await readEvidence('1098006',context,get);assert.throws(()=>validateAnalysis({...generated,evidence_refs:[{message_id:'m1',quote:'Quote never said by anyone',scope:'context'}]},e.prepared,'positive'),/reference/);assert.throws(()=>validateAnalysis(generated,{...e.prepared,analystName:'Someone else'},'positive'),/own_public/);assert.throws(()=>validateAnalysis({...generated,human_influence:{classification:'worsened'}},e.prepared,'positive'),/partial_coverage/)})
test('scope rejects other tickets before claim or network',async()=>{const s=store(),r=request();await assert.rejects(runActivation({ids:['1098085'],allowlist:['1098006','1082449'],store:s.implementation,env,fetchImpl:r.fetchImpl}),/scope_invalid/);assert.deepEqual(s.claimed,[]);assert.equal(r.count(),0)})
test('small executor does exactly two reads then finish, no implicit global claim',async()=>{const s=store(),r=request();const result=await runActivation({ids:['1098006'],allowlist:['1098006','1082449'],store:s.implementation,env,fetchImpl:r.fetchImpl});assert.deepEqual(s.claimed,['1098006']);assert.equal(r.count(),2);assert.equal(s.saved.length,1);assert.equal(s.failed.length,0);assert.equal(record(result.results[0]).status,'done');assert.equal(result.csat_changed,false);assert.ok(!JSON.stringify(result).includes('s-provider'))})
test('attachments stop Gemini and save, retaining a concrete gap',async()=>{const s=store(),r=request();const fetchImpl=(async(input:URL|RequestInfo)=>String(input).endsWith('/messages')?Response.json({messages:[{...msg,attachments:[{id:'file'}]}]}):r.fetchImpl(input)) as typeof fetch;const result=await runActivation({ids:['1098006'],allowlist:['1098006'],store:s.implementation,env,fetchImpl});assert.equal(r.count(),0);assert.equal(s.saved.length,0);assert.equal(record(result.results[0]).status,'gap')})
test('embedded HTML and Markdown media block despite empty attachments',async()=>{
 for(const body of ['<img src="private-file">','![captura](private-file)','<audio src="file"></audio>']){
  const m={...msg,body},d={...detail,messages:[m]}
  const e=await readEvidence('1098006',context,async path=>path.endsWith('/messages')?{messages:[m]}:path.endsWith('/events')?{events:[]}:d)
  assert.ok(e.gaps.includes('embedded_media_uninspected'))
 }
})
test('accusations are rejected in every narrative field before and after normalization',async()=>{
 const evidence=await readEvidence('1098006',context,get)
 const paths=[['primary_cause','summary'],['human_influence','summary'],['controllability','summary'],['coaching_signal','summary'],['analyst_takeaway','summary'],['evidence_summary','0'],['limitations','0'],...['negative_rating_hypothesis','customer_experience_impact','observable_analyst_behavior','practice_to_improve','suggested_phrase','verification_check','attribution_caution'].map(key=>['cx_coaching',key])]
 for(const phrase of ['O analista falhou no atendimento.','Não demonstrou empatia com o cliente.','Encerrou prematuramente a conversa.'])for(const [section,key] of paths){
  const changed=structuredClone(generated) as Record<string,unknown>
  if(Array.isArray(changed[section]))changed[section]=[phrase]
  else changed[section]={...record(changed[section]),[key]:phrase}
  assert.throws(()=>validateAnalysis(changed,evidence.prepared,'positive'),/partial_coverage_fault_language/,section+'.'+key)
 }
 assert.throws(()=>rejectFaultLanguage({cx_coaching:{source:'normalized',observable_analyst_behavior:'O analista falhou'}}),/fault_language/)
 assert.throws(()=>validateAnalysis({...generated,analyst_takeaway:{kind:'develop',summary:'Proposta futura para confirmar a próxima ação.'}},evidence.prepared,'positive'),/development_judgment/)
})
test('message text is redacted before prompt and references must match redacted text',async()=>{
 const m={...msg,body:msg.body+' Contato: private@example.com https://private.example/secret CPF 123.456.789-00 telefone (11) 99999-9999'}
 const e=await readEvidence('1098006',context,async path=>path.endsWith('/messages')?{messages:[m]}:path.endsWith('/events')?{events:[]}:{...detail,messages:[m]})
 assert.ok(!e.prepared.messages[0].text.includes('private'))
 assert.ok(!e.prepared.messages[0].text.includes('123.456'))
 assert.throws(()=>validateAnalysis({...generated,evidence_refs:[{message_id:'m1',quote:'private@example.com',scope:'analyst_behavior'}]},e.prepared,'positive'),/reference_invalid/)
 const a=validateAnalysis({...generated,evidence_refs:[{message_id:'m1',quote:evidenceCatalogue(e.prepared)[0].quote,scope:'analyst_behavior'}]},e.prepared,'positive');assert.equal(a._evidence_redacted,true)
})
test('catalogue supplies unique literal snippets and finite schema enums',async()=>{
 const e=await readEvidence('1098006',context,get)
 const long='Início literal '.repeat(30)+' Meio literal '.repeat(30)+' Fim literal '.repeat(30)
 const prepared={...e.prepared,messages:[...e.prepared.messages,{...e.prepared.messages[0],id:'long',text:long},{...e.prepared.messages[0],id:'customer',authorType:'contact',text:'Mensagem pública do cliente com contexto verificável.'}]}
 const catalogue=evidenceCatalogue(prepared)
 assert.equal(catalogue.filter(c=>c.message_id==='long').length,3)
 for(const c of catalogue){assert.ok(c.quote.length>=12&&c.quote.length<=240);assert.ok(prepared.messages.find(m=>m.id===c.message_id)?.text.includes(c.quote))}
 assert.deepEqual(catalogue.find(c=>c.message_id==='customer')?.allowed_scopes,['context'])
 const schema=evidenceBoundSchema(prepared),refs=record(schema.properties.evidence_refs),items=record(refs.items),properties=record(items.properties)
 assert.deepEqual(record(properties.reference_id).enum,catalogue.map(c=>c.reference_id))
 assert.equal(properties.message_id,undefined);assert.equal(properties.quote,undefined)
 const quote=catalogue.find(c=>c.message_id==='customer')!.quote
 assert.throws(()=>validateAnalysis({...generated,evidence_refs:[{message_id:'invented',quote,scope:'context'}]},prepared,'positive'),/reference_invalid/)
 assert.throws(()=>validateAnalysis({...generated,evidence_refs:[{message_id:'m1',quote,scope:'context'}]},prepared,'positive'),/reference_invalid/)
})
test('retry is exclusively failed1098006 attempt1 reference error without lease',()=>{
 const eligible={status:'failed',attempts:1,error_code:'evidence_reference_invalid',lease_token:null}
 assert.equal(activationClaimPlan('1098006',eligible)?.nextAttempt,2)
 for(const [id,row] of [['1082449',eligible],['1098006',{...eligible,attempts:2}],['1098006',{...eligible,error_code:'evidence_gap'}],['1098006',{...eligible,lease_token:'existing'}],['1098006',{...eligible,status:'processing'}]] as const)assert.equal(activationClaimPlan(id,row),null)
})
test('third attempt is exclusively1098006 attempt2 provider400; no fourth for400',()=>{
 const row={status:'failed',attempts:2,error_code:'provider_http_400',lease_token:null}
 assert.equal(activationClaimPlan('1098006',row)?.nextAttempt,3)
 assert.equal(activationClaimPlan('1082449',row),null)
 assert.equal(activationClaimPlan('1098006',{...row,attempts:3}),null)
 assert.equal(activationClaimPlan('1098006',{...row,error_code:'provider_http_429'}),null)
})
test('reference adapter resolves selected literal evidence without model-provided quote',async()=>{
 const e=await readEvidence('1098006',context,get),raw={...generated,evidence_refs:[{reference_id:'E1',scope:'analyst_behavior'}]}
 const hydrated=hydrateEvidenceReferences(raw,e.prepared)
 assert.deepEqual(hydrated.evidence_refs,[{message_id:'m1',quote:msg.body,scope:'analyst_behavior'}])
 assert.equal(validateAnalysis(hydrated,e.prepared,'positive').analyst_takeaway.kind,'maintain')
 for(const refs of [[{reference_id:'E999',scope:'context'}],[{reference_id:'E1',scope:'invalid'}],[{reference_id:'E1',scope:'context',quote:'invented'}],[]])assert.throws(()=>hydrateEvidenceReferences({...raw,evidence_refs:refs},e.prepared),/reference_invalid/)
 const other={...e.prepared,messages:[{...e.prepared.messages[0],authorType:'contact'}]}
 assert.throws(()=>hydrateEvidenceReferences(raw,other),/reference_invalid/)
})
test('provider400 diagnostic excludes freeform errors and secrets',async()=>{
 const result=await safeProviderError(Response.json({error:{code:400,status:'INVALID_ARGUMENT',message:'SECRET email@example.com',details:[{token:'SECRET'}]}},{status:400}))
 assert.deepEqual(result,{http_status:400,provider_status:'INVALID_ARGUMENT',provider_code:400})
 assert.ok(!JSON.stringify(result).includes('SECRET'))
 const untrusted=await safeProviderError(Response.json({error:{status:'SECRET',code:'SECRET'}},{status:400}))
 assert.equal(untrusted.provider_status,null);assert.equal(untrusted.provider_code,null)
})
test('uncorroborated content reports unverified coverage without asserting agreement',async()=>{
 const e=await readEvidence('1082449',context,async path=>path.endsWith('/messages')?{messages:[{...msg,body:'Divergent body in native messages.'}]}:path.endsWith('/events')?{events:[]}:{...detail,id:'1082449'})
 assert.equal(e.coverage.mode,'unverified');assert.ok(!e.coverage.limitation.includes('mensagens conferem'))
})


test('disagreement retains both verified readings and cannot assert human influence',async()=>{
 const e=await readEvidence('1098006',context,get)
 const first=validateAnalysis(generated,e.prepared,'positive')
 const second={...first,human_influence:{classification:'neutral' as const,summary:'A mudança não foi estabelecida.',confidence:'low' as const}}
 const combined=combineReadings(first,second)
 assert.equal(combined._readings_agreed,false)
 assert.equal(combined.human_influence.classification,'unclear')
 assert.equal(combined.analyst_takeaway.kind,'none')
 assert.equal(combined._independent_readings.length,2)
 assert.equal(combined.exclusion_eligible,false)
})

test('one503 retry respects five-minute cooldown and cannot repeat',()=>{
 const failedAt=Date.parse('2026-11-24T11:13:00Z')
 const row={status:'failed',attempts:3,error_code:'provider_http_503',lease_token:null,updated_at:new Date(failedAt).toISOString()}
 assert.equal(activationClaimPlan('1098006',row,failedAt+299999),null)
 assert.equal(activationClaimPlan('1098006',row,failedAt+300000)?.nextAttempt,4)
 assert.equal(activationClaimPlan('1082449',row,failedAt+300000),null)
 assert.equal(activationClaimPlan('1098006',{...row,attempts:4},failedAt+600000)?.nextAttempt,5)
 assert.equal(activationClaimPlan('1098006',{...row,attempts:5},failedAt+600000),null)
 assert.equal(activationClaimPlan('1098006',{...row,attempts:5,error_code:'activation_error'},failedAt+600000)?.nextAttempt,6)
 assert.equal(activationClaimPlan('1098006',{...row,attempts:6,error_code:'activation_error'},failedAt+600000),null)
 assert.equal(activationClaimPlan('1082449',{...row,attempts:4},failedAt+600000),null)
 assert.equal(activationClaimPlan('1098006',{...row,updated_at:'invalid'},failedAt+600000),null)
})

test('canonical partial-coverage cautions never contradict the unchanged language validator',async()=>{
 const e=await readEvidence('1098006',context,get)
 assert.doesNotThrow(()=>rejectFaultLanguage(e.coverage.limitation))
 const a=validateAnalysis(generated,e.prepared,'positive')
 assert.doesNotThrow(()=>rejectFaultLanguage(a))
 assert.throws(()=>rejectFaultLanguage('falha por omissão'),/fault_language/)
})


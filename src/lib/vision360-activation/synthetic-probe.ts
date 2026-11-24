import {runActivation,type Store,record} from './runner.ts'
/** Structural facts only: never return model prose, unexpected keys, IDs, or quotes. */
export function syntheticReferenceShape(raw:unknown,expectedIds:readonly string[]){
 const refs=record(raw).evidence_refs,values=Array.isArray(refs)?refs:[]
 const known=new Set(expectedIds),seen=new Set<string>()
 let invalidIds=0,duplicates=0,invalidScopes=0,extraFields=0,nonObjects=0
 for(const value of values){
  const r=record(value),id=typeof r.reference_id==='string'?r.reference_id:''
  if(!value||typeof value!=='object'||Array.isArray(value))nonObjects++
  if(!known.has(id))invalidIds++
  if(id&&seen.has(id))duplicates++
  seen.add(id)
  if(!['context','analyst_behavior'].includes(String(r.scope)))invalidScopes++
  extraFields+=Object.keys(r).filter(key=>!['reference_id','scope'].includes(key)).length
 }
 return {references_array:Array.isArray(refs),reference_count:Array.isArray(refs)?refs.length:null,expected_reference_count:expectedIds.length,invalid_reference_count:invalidIds,duplicate_reference_count:duplicates,invalid_scope_count:invalidScopes,unexpected_field_count:extraFields,non_object_count:nonObjects}
}
/** Exercises the exact full analysis schema and validators with fictitious messages, never business rows. */
export async function syntheticAnalysisProbe(env:Record<string,string|undefined>,request:typeof fetch=fetch){
 const message={id:'synthetic-message-1',created_at:'2026-11-17T18:38:00Z',author:{name:'Analista Sintético',type:'agent'},visibility:'public',body:'Verifiquei a solicitação e expliquei ao cliente o procedimento de conferência e os próximos passos.',attachments:[]}
 const detail={id:'synthetic-ticket',updated_at:'2026-11-17T19:00:00Z',messages:[message]}
 let preserved:unknown=null,selectedModel:string|null=null
 const providerContracts:Array<ReturnType<typeof syntheticReferenceShape>&{json_parsed:boolean}>=[]
 const store:Store={
  claim:async()=>({ticket_id:'synthetic-ticket',analyst_id:'synthetic-analyst',team_id:'synthetic-team',occurred_date:'2026-11-17',satisfaction_label:'positive',attempts:1,lease_token:'synthetic-lease'}),
  context:async()=>({analystName:'Analista Sintético',ratedAt:'2026-11-17T18:39:00Z',area:'Teste fictício',ledgerMatches:true}),
  finish:async(_work,analysis,model)=>{preserved=analysis;selectedModel=model;return true},
  fail:async()=>{},
 }
 const fetchImpl=(async(input:URL|RequestInfo,init?:RequestInit)=>{
  const url=String(input)
  if(url.startsWith('https://generativelanguage.googleapis.com/')){
   const response=await request(input,init)
   if(response.ok){
    try{
     const payload=record(await response.clone().json()),candidates=payload.candidates,candidate=record(Array.isArray(candidates)?candidates[0]:null),parts=record(candidate.content).parts
     const generated=(Array.isArray(parts)?parts:[]).map(record).filter(p=>!p.thought).map(p=>typeof p.text==='string'?p.text:'').join('')
     providerContracts.push({...syntheticReferenceShape(JSON.parse(generated),['E1']),json_parsed:true})
    }catch{providerContracts.push({...syntheticReferenceShape(null,['E1']),json_parsed:false})}
   }
   return response
  }
  if(url.startsWith('https://api.desk.click.app/api/v1/tickets/synthetic-ticket')){
   return Response.json(url.endsWith('/messages')?{messages:[message]}:url.endsWith('/events')?{events:[]}:detail)
  }
  throw Error('unexpected_synthetic_destination')
 }) as typeof fetch
 const result=await runActivation({ids:['synthetic-ticket'],allowlist:['synthetic-ticket'],store,env:{...env,CLICKDESK_API_KEY:'synthetic-unused',CLICKDESK_ACCOUNT_ID:'synthetic-unused',GEMINI_MODEL:env.CX360_MODEL?.trim()||'gemini-3.5-flash-lite'},fetchImpl})
 return {synthetic:true,customer_data_sent:false,database_mutations:0,result,analysis:preserved,model:selectedModel,provider_contracts:providerContracts}
}


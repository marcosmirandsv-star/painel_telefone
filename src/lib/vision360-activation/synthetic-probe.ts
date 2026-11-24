import {runActivation,type Store} from './runner.ts'
/** Exercises the exact full analysis schema and validators with fictitious messages, never business rows. */
export async function syntheticAnalysisProbe(env:Record<string,string|undefined>,request:typeof fetch=fetch){
 const message={id:'synthetic-message-1',created_at:'2026-11-17T18:38:00Z',author:{name:'Analista Sintético',type:'agent'},visibility:'public',body:'Verifiquei a solicitação e expliquei ao cliente o procedimento de conferência e os próximos passos.',attachments:[]}
 const detail={id:'synthetic-ticket',updated_at:'2026-11-17T19:00:00Z',messages:[message]}
 let preserved:unknown=null,selectedModel:string|null=null
 const store:Store={
  claim:async()=>({ticket_id:'synthetic-ticket',analyst_id:'synthetic-analyst',team_id:'synthetic-team',occurred_date:'2026-11-17',satisfaction_label:'positive',attempts:1,lease_token:'synthetic-lease'}),
  context:async()=>({analystName:'Analista Sintético',ratedAt:'2026-11-17T18:39:00Z',area:'Teste fictício',ledgerMatches:true}),
  finish:async(_work,analysis,model)=>{preserved=analysis;selectedModel=model;return true},
  fail:async()=>{},
 }
 const fetchImpl=(async(input:URL|RequestInfo,init?:RequestInit)=>{
  const url=String(input)
  if(url.startsWith('https://generativelanguage.googleapis.com/'))return request(input,init)
  if(url.startsWith('https://api.desk.click.app/api/v1/tickets/synthetic-ticket')){
   return Response.json(url.endsWith('/messages')?{messages:[message]}:url.endsWith('/events')?{events:[]}:detail)
  }
  throw Error('unexpected_synthetic_destination')
 }) as typeof fetch
 const result=await runActivation({ids:['synthetic-ticket'],allowlist:['synthetic-ticket'],store,env:{...env,CLICKDESK_API_KEY:'synthetic-unused',CLICKDESK_ACCOUNT_ID:'synthetic-unused',GEMINI_MODEL:env.CX360_MODEL?.trim()||'gemini-3.5-flash-lite'},fetchImpl})
 return {synthetic:true,customer_data_sent:false,database_mutations:0,result,analysis:preserved,model:selectedModel}
}

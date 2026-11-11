import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as daily from '../src/lib/clickdesk-official-daily.ts'
const source=readFileSync(new URL('../src/lib/clickdesk-official-metrics.ts',import.meta.url),'utf8')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function load(missing=false) {
 const calls:unknown[]=[]
 const person={id:'own',name:'Analista',team_id:'fiscal',active:true}
 const metric={source_owner_name:'Analista',source_owner_key:'analista',attendances:10,positive_reviews:4,negative_reviews:1,captured_at:'2026-11-11T10:00:00Z'}
 const admin={from:()=>({select:async()=>({data:[person],error:null})}),rpc:async(name:string,args:{p_start:string;p_end:string})=>{
 calls.push([name,args])
 if(name==='get_scoped_clickdesk_official_period_metrics')return {data:args.p_start==='2026-11-01'&&args.p_end==='2026-11-10'?[metric]:[],error:null}
 return {data:Array.from({length:missing?9:10},(_,i)=>({...metric,occurred_date:`2026-11-${String(i+1).padStart(2,'0')}`,attendances:1,positive_reviews:i<4?1:0,negative_reviews:i===4?1:0})),error:null}
 }}
 const exports:Record<string,unknown>={}
 runInNewContext(compiled,{exports,require:(id:string)=>id==='./integration-server'?{ApiError:class extends Error {constructor(_status:number,message:string){super(message)}}}:id==='./clickdesk-official-daily'?daily:id==='./clickdesk-publication'?{publishedClickDeskEnd:()=> '2026-11-10'}:{},Date,console})
 return {admin,calls,read:exports.loadOfficialPeriodRows as (admin:unknown,filters:unknown)=>Promise<{rows:{attendances:number;reviews:number;analyst_id:string}[];dailyRows:unknown[]}>}
}
test('semana deriva do calendário conciliado e conserva o vínculo individual e filtros de equipe',async()=>{
 const h=load();const result=await h.read(h.admin,{start:'2026-11-02',end:'2026-11-08',analystId:'own',teamId:'fiscal'})
 assert.equal(result.rows[0].attendances,7);assert.equal(result.rows[0].reviews,4);assert.equal(result.rows[0].analyst_id,'own');assert.equal(result.dailyRows.length,7)
 await assert.rejects(h.read(h.admin,{start:'2026-11-02',end:'2026-11-08',analystId:'other'}),/distribuição diária/)
})
test('dia ausente impede publicar semana parcial como se fosse completa',async()=>{
 const h=load(true)
 await assert.rejects(h.read(h.admin,{start:'2026-11-02',end:'2026-11-08'}),/distribuição diária/)
})

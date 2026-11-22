const {test} = require('node:test')
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {runInNewContext} = require('node:vm')
const ts = require('typescript')
const source = readFileSync('src/app/api/clickdesk/neutral-reviews/route.ts', 'utf8')
const compiled = ts.transpileModule(source.replace(/^import[^\r\n]*\r?\n/gm, '').replace(/export /g, ''), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText
function harness(hash) {
 const vote = {ticket_id:'1', ticket_number:'1', analyst_id:'a', team_id:'t', occurred_date:'2026-11-10', source_hash:'new'}
 const review = {ticket_id:'1', source_hash:hash, status:'verified', cause:'system', exclusion_eligible:true, reviewed_at:'2026-11-11', analysis:{explanation:'parecer anterior',evidence_quotes:['trecho anterior'],pattern:'long_silence',pattern_supported:true}}
 const db={from(name){const chain={select(){return chain},eq(){return chain},order(){return chain},range(){return chain},in(){return chain},then(resolve){return Promise.resolve({data:name==='clickdesk_official_period_votes'?[vote]:name==='clickdesk_neutral_reviews'?[review]:[],error:null}).then(resolve)}};return chain},rpc:async()=>({data:{},error:null})}
 class ApiError extends Error {constructor(status,message){super(message);this.status=status}}
 return runInNewContext(compiled+'\nGET',{ApiError,URL,Date,Set,Response,isChatProductionEnabled:()=>true,authorizeClickDeskSessionClient:async()=>({isManagement:true,admin:db}),handle:fn=>fn(),json:Response.json})
}
async function run(hash){const result=await harness(hash)(new Request('https://example.test/api?start=2026-11-01&end=2026-11-22'));return (await result.json()).items[0]}
test('revisão de fonte antiga não apresenta parecer ou evidência como atuais',async()=>{const r=await run('old');assert.equal(r.status,'pending');assert.equal(r.cause,'inconclusive');assert.equal(r.excluded,false);assert.equal(r.explanation,'Aguardando revisão da conversa.');assert.deepEqual(r.evidence,[]);assert.equal(r.pattern,'none');assert.equal(r.reviewed_at,null)})
test('revisão da fonte atual preserva informação existente',async()=>{const r=await run('new');assert.equal(r.status,'verified');assert.equal(r.cause,'system');assert.equal(r.excluded,true);assert.equal(r.explanation,'parecer anterior');assert.deepEqual(r.evidence,['trecho anterior']);assert.equal(r.pattern,'long_silence');assert.equal(r.reviewed_at,'2026-11-11')})

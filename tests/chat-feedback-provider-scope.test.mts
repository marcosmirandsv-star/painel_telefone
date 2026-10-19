import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const source=readFileSync(new URL('../src/app/api/chat-feedback/route.ts',import.meta.url),'utf8')
function harness(fail=false){
 const calls:string[]=[]
 const start=source.indexOf('async function generateExternalFeedback(')
 const end=source.indexOf('export async function POST(',start)
 const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const generate=runInNewContext(code+'\ngenerateExternalFeedback',{
  getServerSupabaseConfig:()=>({environment:'homologacao'}),
  process:{env:{CHAT_AI_PROVIDER:'github-models',GEMINI_API_KEY:'test-placeholder'}},
  generateWithGemini:async()=>{calls.push('gemini');if(fail)throw Error('provider_unavailable');return 'Coaching baseado em evidência.'},
  generateWithGitHubModels:async()=>{calls.push('github');return 'unexpected'},
  generateWithVercelGateway:async()=>{calls.push('gateway');return 'unexpected'}
 }) as (prompt:string,style:string)=>Promise<{source:string;feedback:string}>
 return {generate,calls}
}
test('feedback de homologação usa somente Gemini mesmo com outro provedor legado configurado',async()=>{
 const h=harness();assert.equal((await h.generate('test-only','coach')).source,'gemini');assert.deepEqual(h.calls,['gemini'])
})
test('falha do Gemini não envia dados para outro provedor; a rota pode usar o texto local',async()=>{
 const h=harness(true);await assert.rejects(h.generate('test-only','coach'),/provider_unavailable/);assert.deepEqual(h.calls,['gemini'])
})

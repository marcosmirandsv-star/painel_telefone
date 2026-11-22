import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'

const root=new URL('../',import.meta.url)
const read=(p:string)=>readFileSync(new URL(p,root),'utf8')
const compile=(s:string)=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function enabled(env:Record<string,string>){const fixtureModule={exports:{}};vm.runInNewContext(compile(read('src/lib/chat-production-gate.ts')),{module:fixtureModule,exports:fixtureModule.exports,process:{env}});return (fixtureModule.exports as {isChatProductionEnabled:()=>boolean}).isChatProductionEnabled()}
const production={CHAT_OFFICIAL_ENABLED:'true',VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://qmetbydkepfdgfqkdkai.supabase.co'}
test('Chat exige liberação explícita e ambiente e banco exatos',()=>{
 assert.equal(enabled({}),false);assert.equal(enabled(production),true)
 for(const change of [{CHAT_OFFICIAL_ENABLED:'false'},{VERCEL_ENV:'preview'},{NEXT_PUBLIC_SUPABASE_URL:'https://vvtorcvchnqhcredhorv.supabase.co'},{NEXT_PUBLIC_SUPABASE_URL:'https://outro.supabase.co'}])assert.equal(enabled({...production,...change}),false)
})
test('feedback de Telefone continua no comportamento anterior mesmo com Chat liberado',async()=>{
 const source=read('src/app/api/chat-feedback/route.ts');const wrapper=source.slice(source.lastIndexOf('export async function POST'))
 const code=compile(wrapper.replace('export ',''))+'\nPOST'
 for(const gate of [true,false])for(const serviceModule of ['phone',undefined,'chat']){
  const calls:string[]=[];const POST=vm.runInNewContext(code,{isChatProductionEnabled:()=>gate,legacy:{POST:()=>{calls.push('legacy');return Response.json({legacy:true})}},officialPOST:()=>{calls.push('chat');return Response.json({chat:true})}})
  await POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({serviceModule})}))
  assert.deepEqual(calls,[gate&&serviceModule==='chat'?'chat':'legacy'])
 }
})
test('auxiliares compartilhados, CX e versão anterior do feedback preservados',()=>{
 const git=(path:string)=>execFileSync('git',['show','d3768863588edc9c2bda722515f91bbddb2aaa9f:'+path],{cwd:new URL('.',root),encoding:'utf8'}).replaceAll('\r\n','\n')
 for(const path of ['src/lib/integration-server.ts','src/lib/cx360-server.ts','src/app/globals.css'])assert.equal(read(path).replaceAll('\r\n','\n'),git(path),path)
 const layout=read('src/app/layout.tsx')
 assert.match(layout,/lang=["']pt-BR["']/)
 assert.match(layout,/performance-navigation\.css/)
 assert.match(layout,/Central de Performance/)
 assert.equal(read('src/lib/chat-production-legacy/chat-feedback.ts').replaceAll('\r\n','\n'),git('src/app/api/chat-feedback/route.ts').replace("from '../../../lib/phone-report.ts'","from '../phone-report.ts'"))
})


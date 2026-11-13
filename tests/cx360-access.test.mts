import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require=createRequire(import.meta.url)
const compile=async(name:string)=>ts.transpileModule(await readFile(new URL('../src/lib/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const integrationCode=await compile('integration-server.ts'),authorizationCode=await compile('cx360-server.ts')
const token='test-session-without-real-credentials'
function harness(role:string|null,options:{invalidUser?:boolean;profileError?:boolean;preview?:boolean}={}){
 const integration={exports:{}};vm.runInNewContext(integrationCode,{exports:integration.exports,module:integration,require,process:{env:{}},Response,Buffer})
 const calls:unknown[]=[]
 const client={
  auth:{getUser:async()=>({data:{user:options.invalidUser?null:{id:'test-user',user_metadata:{role:'master'}}},error:options.invalidUser?{}:null})},
  from:(table:string)=>{
   calls.push(table)
   return {select:()=>({eq:(column:string,value:string)=>{
    calls.push({column,value})
    return {maybeSingle:async()=>({data:role?{role}:null,error:options.profileError?{}:null})}
   }})}
  }
 }
 const createClient=(_url:string,_key:string,config:unknown)=>{calls.push(config);return client}
 const module={exports:{}};vm.runInNewContext(authorizationCode,{exports:module.exports,module,require:(id:string)=>id==='./integration-server'?integration.exports:id==='@supabase/supabase-js'?{createClient}:require(id),process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://qmetbydkepfdgfqkdkai.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public-key',VERCEL_ENV:options.preview?'preview':'production'}}})
 return {authorize:(module.exports as {authorizeCx:(r:Request)=>Promise<{client:unknown;userId:string}>}).authorizeCx,client,calls}
}
const request=()=>new Request('https://example.test/api/gestao-inteligente',{headers:{Authorization:'Bearer '+token}})
const denied=(status:number)=>(error:unknown)=>(error as {status:number}).status===status
test('CX recusa ausência de sessão e usuário não validado pelo Auth',async()=>{
 const h=harness('master');await assert.rejects(h.authorize(new Request('https://example.test')),denied(401));assert.equal(h.calls.length,0)
 const invalid=harness('master',{invalidUser:true});await assert.rejects(invalid.authorize(request()),denied(401));assert.ok(!invalid.calls.includes('profiles'))
})
test('CX consulta perfil persistido e não aceita papel Master em metadados editáveis',async()=>{
 for(const role of ['analista','analyst','desconhecido',null])await assert.rejects(harness(role).authorize(request()),denied(403))
 await assert.rejects(harness('master',{profileError:true}).authorize(request()),denied(403))
})
test('CX mantém JWT do solicitante no acesso da gestão e impede processamento em preview',async()=>{
 for(const role of ['master','coordenadora']){const h=harness(role),result=await h.authorize(request());assert.equal(result.userId,'test-user');assert.equal(result.client,h.client);assert.ok(JSON.stringify(h.calls).includes('Bearer '+token));assert.ok(JSON.stringify(h.calls).includes('test-user'))}
 const preview=harness('master',{preview:true});await assert.rejects(preview.authorize(request()),denied(503));assert.equal(preview.calls.length,0)
})

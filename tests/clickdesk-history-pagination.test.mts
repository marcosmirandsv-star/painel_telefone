import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { object, text } from '../src/lib/clickdesk-final-owner.ts'
// Exercise the actual production reader without loading server credentials into tests.
const source=readFileSync(new URL('../src/lib/clickdesk-final-owner-server.ts',import.meta.url),'utf8')
const parsed=ts.createSourceFile('reader.ts',source,ts.ScriptTarget.Latest,true)
const parts=parsed.statements.filter(n=>n.getText(parsed).startsWith('const unwrap =') || (ts.isFunctionDeclaration(n)&&n.name?.text==='readTicketHistory')).map(n=>n.getText(parsed).replace(/^export /,''))
const code=ts.transpileModule(parts.join('\n')+'\nglobalThis.reader=readTicketHistory',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const scope:{object:typeof object;text:typeof text;encodeURIComponent:typeof encodeURIComponent;reader?: (id:string,get:(p:string)=>Promise<unknown>)=>Promise<{complete:boolean;messages:unknown[]}>}={object,text,encodeURIComponent}
runInNewContext(code,scope)
const read=scope.reader!
test('all explicit pages are traversed',async()=>{
 const calls:string[]=[]
 const result=await read('1',async path=>{
  calls.push(path)
  if(path==='/tickets/1')return {id:1,messages:[{id:1},{id:2}]}
  if(path.includes('/events'))return {events:[]}
  const page=Number(new URL('https://test'+path).searchParams.get('page'))
  return {messages:[{id:page}],last_page:2}
 })
 assert.equal(result.complete,true);assert.equal(result.messages.length,2)
 assert.ok(calls.some(p=>p.includes('page=2')))
})
test('a repeated capped page is incomplete, never an infinite loop or a final owner',async()=>{
 const messages=Array.from({length:200},(_,id)=>({id}))
 const result=await read('1',async path=>path==='/tickets/1'?{id:1,messages}:path.includes('/events')?{events:[]}:{messages})
 assert.equal(result.complete,false)
})
test('later messages present only in ticket detail invalidate coverage',async()=>{
 const result=await read('1',async path=>path==='/tickets/1'?{id:1,messages:[{id:1},{id:2}]}:path.includes('/events')?{events:[]}:{messages:[{id:1}]})
 assert.equal(result.complete,false)
})
test('ticket ID mismatch cannot reconcile the wrong public-number alias',async()=>{
 const result=await read('1',async()=>({id:2,messages:[]}))
 assert.equal(result.complete,false)
})

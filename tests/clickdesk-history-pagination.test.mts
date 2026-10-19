import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { object, text, finalHumanTicket } from '../src/lib/clickdesk-final-owner.ts'
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

function longEvidence(options:{wrongAuthor?:boolean;truncated?:boolean;internal?:boolean}={}) {
 const messages=Array.from({length:201},(_,i)=>({id:String(i+1),created_at:new Date(Date.UTC(2026,9,5,12,i)).toISOString(),author_type:'agent',author:i===200?'Final Analyst':'First Analyst',visibility:options.internal&&i===200?'internal':'public'}))
 const transcript=messages.slice(0,options.truncated?200:201).map(m=>{const d=m.created_at;return '['+d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4)+' '+d.slice(11,16)+'] '+(options.wrongAuthor&&m.id==='201'?'Wrong Analyst':m.author)+(m.visibility==='internal'?' [nota interna]':'')+':\nMensagem\n'}).join('\n')
 const get=async(path:string)=>path==='/tickets/1'?{id:1,messages}:path.includes('/events')?{events:[]}:path.endsWith('/transcript')?transcript:{messages:messages.slice(0,200)}
 return {messages,get}
}
test('histórico com página truncada é recuperado somente com detalhe e transcrição integral corroborados',async()=>{
 const fixture=longEvidence(),result=await read('1',fixture.get)
 assert.equal(result.complete,true);assert.equal(result.messages.length,201)
 const row=finalHumanTicket('1',result.messages,[],{satisfaction:{sentiment:'negative'}},[{id:'first',name:'First Analyst',team_id:'team'},{id:'final',name:'Final Analyst',team_id:'team'}],result.complete)
 assert.equal(row.analyst_id,'final');assert.equal(row.satisfaction_label,'negative')
})
test('corroboração recusa transcrição truncada ou autoria divergente',async()=>{
 for(const options of [{wrongAuthor:true},{truncated:true}]){
  const fixture=longEvidence(options),result=await read('1',fixture.get)
  assert.equal(result.complete,false)
 }
})
test('nota interna corroborada nunca substitui a última resposta pública humana',async()=>{
 const fixture=longEvidence({internal:true}),result=await read('1',fixture.get)
 assert.equal(result.complete,true)
 const row=finalHumanTicket('1',result.messages,[],{},[{id:'first',name:'First Analyst',team_id:'team'},{id:'final',name:'Final Analyst',team_id:'team'}],result.complete)
 assert.equal(row.analyst_id,'first')
})

test('ticket, messages and events start together without weakening completeness checks',async()=>{
 const waiting=new Map<string,(value:unknown)=>void>()
 const task=read('1',path=>new Promise(resolve=>waiting.set(path,resolve)))
 assert.equal(waiting.size,3,'independent source requests must not wait for ticket detail')
 for(const [path,resolve]of waiting)resolve(path==='/tickets/1'?{id:1,messages:[]}:path.includes('/events')?{events:[]}:{messages:[]})
 assert.equal((await task).complete,true)
})

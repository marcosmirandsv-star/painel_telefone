import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionIdentityGuard} from '../src/lib/session-identity.ts'

test('gestor → analista e analista → gestor invalidam a tela anterior',()=>{
 const changed=createSessionIdentityGuard()
 assert.equal(changed({id:'manager'}),false)
 assert.equal(changed({id:'analyst'}),true)
 assert.equal(changed({id:'manager'}),true)
})
test('renovação de token e eventos repetidos não reiniciam a mesma conta',()=>{
 const changed=createSessionIdentityGuard()
 for(let i=0;i<5;i++)assert.equal(changed({id:'analyst'}),false)
})
test('saída e entrada por outra aba invalidam dados montados',()=>{
 const changed=createSessionIdentityGuard()
 assert.equal(changed({id:'manager'}),false)
 assert.equal(changed(null),true)
 assert.equal(changed(undefined),false)
 assert.equal(changed({id:'analyst'}),true)
})
test('estado inicial vazio não causa ciclo de reload',()=>{
 const changed=createSessionIdentityGuard()
 assert.equal(changed(null),false)
 assert.equal(changed(null),false)
})

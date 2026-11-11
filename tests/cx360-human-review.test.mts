import test from 'node:test'
import assert from 'node:assert/strict'
import {applyHumanReview} from '../src/lib/cx360-human-review.ts'
import type {Diagnosis,Evidence} from '../src/lib/cx360-diagnostics.ts'
const messages:Evidence[]=[{id:'1',at:'2026-11-09T21:00:00Z',role:'Analista',author:'João Pedro Santana',text:'O nosso expediente chegou ao final. Consegue entrar em contato amanhã?',attachments:0},{id:'2',at:'2026-11-09T21:01:00Z',role:'Cliente',text:'Certo, vou retornar amanhã.',attachments:0}]
const candidate:Diagnosis={factor:'conducao',confidence:'media',observation:'A demanda permaneceu pendente.',hypothesis:'A hipótese é que a pendência contribuiu para a nota.',impact:'O cliente precisará de novo contato.',behavior:'O analista informou o fim do expediente.',human_gap:'Encerramento com pendência técnica no mesmo contato.',human_gap_evidence_ids:['1'],practice:'Combinar a continuidade.',suggested_phrase:'Vamos retomar a análise amanhã.',verification:'Conferir o próximo passo documentado.',limitations:[],evidence_ids:['1']}
test('fim de expediente sem política e simples coaching não confirmam falha humana',()=>{
 const result=applyHumanReview(candidate,{confirmed:false,confidence:'alta',basis:'insuficiente',reason:'Não há política que comprove obrigação de continuar após o expediente.',evidence_ids:['1']},messages,'João Pedro Santana')
 assert.equal(result.factor,'inconclusivo');assert.equal(result.human_gap,null);assert.equal(result.human_review?.confirmed,false)
})
test('hipótese de erro de regra técnica não vira culpa mesmo se o segundo modelo concordar',()=>{
 const result=applyHumanReview({...candidate,human_gap:'A restrição pode não ter se aplicado ao caso.'},{confirmed:true,confidence:'alta',basis:'erro_reconhecido_pelo_analista',reason:'Foi proposta uma hipótese sobre a regra do sistema.',evidence_ids:['1']},messages,'João Pedro Santana')
 assert.equal(result.factor,'inconclusivo')
})
test('exige prova do mesmo autor, confiança alta e rejeita referência inventada',()=>{
 const review={confirmed:true,confidence:'alta',basis:'desrespeito_explicito',reason:'A mensagem pública contém insulto explícito à pessoa atendida.',evidence_ids:['1']}
 const insult=[{...messages[0],text:'Você é incompetente e não vou te ajudar.'}]
 assert.equal(applyHumanReview({...candidate,human_gap:'O analista insultou diretamente o cliente.'},review,insult,'João Pedro Santana').factor,'conducao')
 assert.equal(applyHumanReview(candidate,{...review,confidence:'media'},messages,'João Pedro Santana').factor,'inconclusivo')
 assert.equal(applyHumanReview(candidate,review,messages,'Outro analista').factor,'inconclusivo')
 assert.throws(()=>applyHumanReview(candidate,{...review,evidence_ids:['999']},messages,'João Pedro Santana'))
})

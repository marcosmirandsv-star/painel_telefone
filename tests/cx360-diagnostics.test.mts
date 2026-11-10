import test from 'node:test'
import assert from 'node:assert/strict'
import { d1, scopeDates, eligibleOwner, ratingTimestamp, prepareMessages, redactText, validateDiagnosis } from '../src/lib/cx360-diagnostics.ts'

test('D-1 usa Brasília, respeita virada de mês e limita consultas futuras',()=>{
 assert.equal(d1(new Date('2026-11-10T01:00:00Z')),'2026-11-08')
 assert.equal(d1(new Date('2026-11-01T15:00:00Z')),'2026-10-31')
 assert.equal(scopeDates('2026-11-01','2026-11-30',new Date('2026-11-09T15:00:00Z')).end,'2026-11-08')
 assert.throws(()=>scopeDates('2026-11-09','2026-11-09',new Date('2026-11-09T15:00:00Z')),/dia seguinte/)
 assert.throws(()=>scopeDates('2026-02-30','2026-03-01'))
 assert.throws(()=>scopeDates('2026-09-01','2026-10-31'))
})
test('quadro aprovado preserva aliases e exclusões, sem assumir novas pessoas',()=>{
 for(const name of ['João Pedro Vianey','Carlos Lemos','CARLOS HENRIQUE','Polliana Santana'])assert.equal(eligibleOwner(name),true,name)
 for(const name of ['Carine Melo','Lucas Emmanuel','Polyana Ventura','Lorena Almeida','Luan Pereira','Ronei Marcos','David Leodoro','Ana Julia','','IA · Suporte','Pessoa nova'])assert.equal(eligibleOwner(name),false,name)
})
test('data do relatório é local e horários ambíguos ou inválidos são recusados',()=>{
 assert.equal(ratingTimestamp('06/11/2026 18:27'),'2026-11-06T21:27:00.000Z')
 for(const value of ['2026-11-06 18:27','31/02/2026 10:00','06/11/2026 24:00',''])assert.throws(()=>ratingTimestamp(value),value)
})
const message=(id:number,at:string,type='agent',body='Vou analisar o erro informado.')=>({id,created_at:at,author_type:type,visibility:'public',body,attachments:[]})
test('não usa respostas posteriores ou do mesmo minuto para explicar a nota',()=>{
 const result=prepareMessages({messages:[message(1,'2026-11-06T21:25:00Z','contact','Preciso de ajuda com o erro.'),message(2,'2026-11-06T21:27:00Z'),message(3,'2026-11-06T21:28:00Z')]},'2026-11-06T21:27:00Z')
 assert.deepEqual(result.messages.map(m=>m.id),['1'])
 assert.equal(result.human,false)
 assert.ok(result.limitations.some(v=>v.includes('mesmo minuto')))
})
test('histórico extenso ou paginado não é silenciosamente truncado',()=>{
 assert.throws(()=>prepareMessages({messages:[],last_page:2},'2026-11-06T21:27:00Z'),/integral/)
 assert.throws(()=>prepareMessages({messages:Array.from({length:1201},(_,i)=>message(i,'2026-11-06T20:00:00Z'))},'2026-11-06T21:27:00Z'),/extenso/)
 assert.throws(()=>prepareMessages({messages:[{id:1,body:'Sem horário'}]},'2026-11-06T21:27:00Z'),/horário/)
})
test('credenciais e identificadores são omitidos antes de enviar para IA ou armazenar',()=>{
 assert.equal(redactText('senha: exemplo-secreto'),'[Dados de acesso omitidos]')
 const result=prepareMessages({messages:[message(1,'2026-11-06T20:00:00Z','agent','Envie os dados de acesso.'),message(2,'2026-11-06T20:01:00Z','contact','segredo-que-nao-deve-ser-guardado')]},'2026-11-06T21:27:00Z')
 assert.ok(!JSON.stringify(result).includes('segredo-que'))
 assert.ok(!redactText('contato: exemplo@empresa.test, 123.456.789-00, https://site.test?token=abc').includes('empresa.test'))
})
const diagnosis={factor:'conducao',confidence:'media',observation:'Cliente pediu uma orientação específica.',hypothesis:'Hipótese a conferir pela gestão.',impact:'A solicitação permaneceu pendente.',behavior:'O analista pediu detalhes adicionais.',practice:'Registrar o próximo passo combinado.',suggested_phrase:'Posso conferir o resultado com você?',verification:'Conferir o próximo passo nas mensagens.',limitations:['Anexos não inspecionados.'],evidence_ids:['1']}
test('preserva autores humanos distintos sem guardar o nome do cliente como autoria',()=>{
 const result=prepareMessages({messages:[{...message(1,'2026-11-06T20:00:00Z'),author:'Carlos Henrique'},{...message(2,'2026-11-06T20:01:00Z'),author:'Vanessa Silva'},{...message(3,'2026-11-06T20:02:00Z','contact'),author:'Cliente de teste'}]},'2026-11-06T21:27:00Z')
 assert.deepEqual(result.messages.map(m=>m.author),['Carlos Henrique','Vanessa Silva',undefined])
})
test('saída da IA exige evidências reais e todos os campos, sem aceitar IDs inventados',()=>{
 const messages=prepareMessages({messages:[message(1,'2026-11-06T20:00:00Z')]},'2026-11-06T21:27:00Z').messages
 assert.equal(validateDiagnosis({...diagnosis,human_gap:'Falha concreta indicada na mensagem.',human_gap_evidence_ids:['1']},messages,true).factor,'conducao')
 assert.throws(()=>validateDiagnosis({...diagnosis,evidence_ids:['999']},messages,true),/verificáveis/)
 assert.throws(()=>validateDiagnosis({...diagnosis,evidence_ids:[]},messages,true),/referências/)
 assert.throws(()=>validateDiagnosis({...diagnosis,observation:''},messages,true),/incompleta/)
 assert.throws(()=>validateDiagnosis({...diagnosis,factor:'culpa comprovada'},messages,true),/inválida/)
})
test('sem humano anterior à nota não permite concluir falha de condução humana',()=>{
 const messages=prepareMessages({messages:[message(1,'2026-11-06T20:00:00Z','contact')]},'2026-11-06T21:27:00Z').messages
 const result=validateDiagnosis(diagnosis,messages,false)
 assert.equal(result.factor,'inconclusivo')
 assert.equal(result.confidence,'baixa')
 assert.match(result.behavior,/Não há resposta humana/)
})
test('oportunidade de coaching não basta para classificar causa humana e mensagem de terceiro não sustenta falha',()=>{
 const messages=prepareMessages({messages:[{...message(1,'2026-11-06T20:00:00Z'),author:'Carlos Henrique'}]},'2026-11-06T21:27:00Z').messages
 assert.equal(validateDiagnosis(diagnosis,messages,true,'Carlos Henrique').factor,'inconclusivo')
 assert.equal(validateDiagnosis({...diagnosis,human_gap:'Falha alegada em mensagem de terceiro.',human_gap_evidence_ids:['1']},messages,true,'Vanessa Silva').factor,'inconclusivo')
 assert.equal(validateDiagnosis({...diagnosis,human_gap:'Falha alegada em mensagem inexistente.',human_gap_evidence_ids:['999']},messages,true,'Carlos Henrique').factor,'inconclusivo')
})

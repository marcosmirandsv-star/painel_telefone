import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeQualitativeAnalysis } from '../src/lib/clickdesk-qualitative.ts'

const source=(p:string)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('ticket negativo de NFS-e com encerramento por inatividade recebe coaching específico sem culpa fabricada',()=>{
  const analysis=normalizeQualitativeAnalysis({
    initial_sentiment:'negative',final_sentiment:'unclear',
    primary_cause:{category:'system_or_product',summary:'Erro de emissão de NFS-e por arquivo em desacordo com o XML Schema',confidence:'medium'},
    human_influence:{classification:'unclear',summary:'O atendimento foi encerrado por inatividade antes da confirmação de resolução',confidence:'low'},
    controllability:{classification:'company',summary:'Estrutura do sistema e prefeitura'},
    coaching_signal:{available:false,summary:'Sem evidência de falha individual'},
    analyst_takeaway:{kind:'maintain',summary:'Mantenha instruções diretas de caminho e campos a alterar.',confidence:'medium'},
    evidence_summary:[
      'Cliente relatou falha na emissão de NFS-e',
      'Analista orientou alterar cadastro de atividades e tributação',
      'O chat encerrou automaticamente por inatividade',
    ],
    limitations:['Não é possível saber se o procedimento final resolveu a emissão devido ao encerramento por inatividade'],
  })
  assert.equal(analysis.coaching_signal.available,false)
  assert.equal(analysis.cx_coaching.source,'contextual_from_existing_analysis')
  assert.match(analysis.cx_coaching.negative_rating_hypothesis,/pode ter ficado sem confirmação/)
  assert.match(analysis.cx_coaching.negative_rating_hypothesis,/hipótese/i)
  assert.match(analysis.cx_coaching.practice_to_improve,/testar a solução/)
  assert.match(analysis.cx_coaching.practice_to_improve,/não demonstra que o analista deixou/i)
  assert.match(analysis.cx_coaching.suggested_phrase,/novo teste/)
  assert.match(analysis.cx_coaching.verification_check,/próxima amostra/)
  assert.equal(analysis.cx_coaching.evidence_confidence,'low')
})

test('nova análise estruturada preserva ação mensurável e não substitui sentimento por diagnóstico psicológico',()=>{
  const analysis=normalizeQualitativeAnalysis({
    initial_sentiment:'neutral',final_sentiment:'unclear',
    primary_cause:{category:'process',summary:'Dependência de retorno da prefeitura',confidence:'high'},
    human_influence:{classification:'neutral',summary:'Orientou próximo passo',confidence:'medium'},
    controllability:{classification:'company',summary:'Fluxo externo ao analista'},
    coaching_signal:{available:false,summary:'Nenhuma falta demonstrada'},
    cx_coaching:{
      negative_rating_hypothesis:'Possível frustração com a demora no processamento, sem declaração do motivo da nota.',
      customer_experience_impact:'Cliente não sabia quando obteria nova resposta.',
      observable_analyst_behavior:'Analista explicou como consultar o andamento.',
      practice_to_improve:'Combinar prazo de atualização oficial e canal de retorno.',
      suggested_phrase:'Vou registrar a situação e avisar o caminho de acompanhamento.',
      verification_check:'Conferir no próximo ticket se há próximo passo documentado.',
      attribution_caution:'Não há evidência de má vontade nem de que o analista causou a nota.',
      evidence_confidence:'medium',
    },
  })
  assert.equal(analysis.cx_coaching.source,'generated')
  assert.equal(analysis.cx_coaching.evidence_confidence,'medium')
  assert.match(analysis.cx_coaching.practice_to_improve,/prazo/)
  assert.match(analysis.cx_coaching.attribution_caution,/Não há evidência/)
  assert.equal(analysis.human_influence.classification,'neutral')
})

test('visão geral 360 ignora inativos mas conserva leitura histórica explícita no resumo',()=>{
  const op=source('src/app/api/clickdesk/operation-360/route.ts')
  const summary=source('src/app/api/clickdesk/qualitative-summary/route.ts')
  const edge=source('supabase/functions/clickdesk-360-db/index.ts')
  assert.match(op,/filter\(row => activeIds\.has\(row\.analyst_id\)\)/)
  assert.match(summary,/Boolean\(analystId\) \|\| activeIds\.has\(item\.analyst_id\)/)
  assert.match(edge,/\.from\('chat_analysts'\)\.select\('id'\)\.eq\('active', true\)/)
  assert.match(edge,/activeIds\.has\(String\(row\.analyst_id\)\)/)
  assert.doesNotMatch(op+summary+edge,/\.delete\(/)
})

test('CSAT e aprovação da IA continuam independentes e a orientação aparece para gestores',()=>{
  const page=source('src/app/page.tsx')
  const prompt=source('src/app/api/clickdesk/qualitative/route.ts')
  const lib=source('src/lib/clickdesk-qualitative.ts')
  assert.match(page,/Coaching de experiência do cliente · causa e efeito/)
  assert.match(page,/result\.analysis\.cx_coaching\.practice_to_improve/)
  assert.match(page,/result\.analysis\.cx_coaching\.negative_rating_hypothesis/)
  assert.match(page,/Sugestão elaborada a partir do diagnóstico preservado/)
  assert.match(prompt,/não fabricar culpa/i)
  assert.match(prompt,/practice_to_improve/)
  assert.match(prompt,/suggested_phrase/)
  assert.match(lib,/export const QUALITATIVE_ANALYSIS_VERSION = 2/)
  assert.doesNotMatch(opOrSummary(),/weekly_individual_metrics|weekly_team_metrics|55DBX/)
  function opOrSummary(){return source('src/app/api/clickdesk/operation-360/route.ts')+source('src/app/api/clickdesk/qualitative-summary/route.ts')}
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractTranscriptText,
  normalizeQualitativeAnalysis,
  redactTranscriptText,
} from '../src/lib/clickdesk-qualitative.ts'

test('redação remove identificadores sensíveis antes da análise externa', () => {
  const redacted = redactTranscriptText(
    'Cliente joao@example.com, telefone (31) 99999-8888, CPF 123.456.789-00 e CNPJ 12.345.678/0001-90.',
  )

  assert.doesNotMatch(redacted, /joao@example\.com/)
  assert.doesNotMatch(redacted, /123\.456\.789-00/)
  assert.doesNotMatch(redacted, /12\.345\.678\/0001-90/)
  assert.match(redacted, /\[email\]/)
  assert.match(redacted, /\[telefone\]/)
  assert.match(redacted, /\[cpf\]/)
  assert.match(redacted, /\[cnpj\]/)
})

test('extração reúne mensagens do transcript sem duplicar conteúdo', () => {
  const transcript = extractTranscriptText({
    data: [
      { role: 'customer', text: 'Meu sistema está apresentando erro.' },
      { role: 'analyst', content: 'Vou verificar com você.' },
      { role: 'analyst', content: 'Vou verificar com você.' },
    ],
  })

  assert.match(transcript, /customer: Meu sistema está apresentando erro\./)
  assert.match(transcript, /analyst: Vou verificar com você\./)
  assert.equal((transcript.match(/Vou verificar com você\./g) ?? []).length, 1)
})

test('normalização usa incerteza como padrão quando a IA não sustenta a conclusão', () => {
  const result = normalizeQualitativeAnalysis({
    initial_sentiment: 'angry',
    primary_cause: { category: 'guess', summary: '' },
    human_influence: { classification: 'excellent', summary: '' },
    controllability: { classification: 'unknown' },
    coaching_signal: { available: false },
  })

  assert.equal(result.initial_sentiment, 'unclear')
  assert.equal(result.final_sentiment, 'unclear')
  assert.equal(result.primary_cause.category, 'unclear')
  assert.equal(result.primary_cause.confidence, 'low')
  assert.equal(result.human_influence.classification, 'unclear')
  assert.equal(result.human_influence.confidence, 'low')
  assert.equal(result.controllability.classification, 'unclear')
  assert.equal(result.coaching_signal.available, false)
})

test('normalização preserva classificações válidas e limita evidências', () => {
  const result = normalizeQualitativeAnalysis({
    initial_sentiment: 'negative',
    final_sentiment: 'positive',
    primary_cause: {
      category: 'system_or_product',
      summary: 'Falha do sistema aparece diretamente na conversa.',
      confidence: 'high',
    },
    human_influence: {
      classification: 'improved',
      summary: 'O atendimento reduziu a tensão após orientar a solução.',
      confidence: 'medium',
    },
    controllability: {
      classification: 'mixed',
      summary: 'Há fator de sistema e comportamento de atendimento.',
    },
    coaching_signal: {
      available: true,
      summary: 'Pode reforçar explicação de próximos passos.',
    },
    evidence_summary: ['um', 'dois', 'três', 'quatro'],
    limitations: ['Transcript não informa o tempo de espera anterior.'],
  })

  assert.equal(result.initial_sentiment, 'negative')
  assert.equal(result.final_sentiment, 'positive')
  assert.equal(result.primary_cause.category, 'system_or_product')
  assert.equal(result.human_influence.classification, 'improved')
  assert.equal(result.controllability.classification, 'mixed')
  assert.equal(result.evidence_summary.length, 3)
})


test('aprendizado do analista contextualiza fatores fora do controle sem criar culpa individual', () => {
  const result = normalizeQualitativeAnalysis({
    initial_sentiment: 'neutral',
    final_sentiment: 'negative',
    primary_cause: {
      category: 'process',
      summary: 'A conversa aponta uma limitação do processo interno.',
      confidence: 'high',
    },
    human_influence: {
      classification: 'neutral',
      summary: 'Não há evidência de que a atuação humana tenha piorado o caso.',
      confidence: 'medium',
    },
    controllability: {
      classification: 'company',
      summary: 'O fator principal dependia de processo interno da empresa.',
    },
    coaching_signal: {
      available: false,
      summary: '',
    },
  })

  assert.equal(result.analyst_takeaway.kind, 'context')
  assert.match(result.analyst_takeaway.summary, /processo interno/i)
})

test('aprendizado do analista preserva uma força observável mesmo sem coaching gerencial', () => {
  const result = normalizeQualitativeAnalysis({
    initial_sentiment: 'negative',
    final_sentiment: 'positive',
    primary_cause: {
      category: 'customer_expectation',
      summary: 'A expectativa inicial do cliente não estava alinhada ao fluxo.',
      confidence: 'medium',
    },
    human_influence: {
      classification: 'improved',
      summary: 'A orientação do analista tornou os próximos passos mais claros.',
      confidence: 'high',
    },
    controllability: {
      classification: 'analyst',
      summary: 'A clareza da orientação estava sob controle do analista.',
    },
    coaching_signal: {
      available: false,
      summary: '',
    },
  })

  assert.equal(result.analyst_takeaway.kind, 'maintain')
  assert.match(result.analyst_takeaway.summary, /próximos passos/i)
})

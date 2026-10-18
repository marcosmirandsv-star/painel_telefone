export type QualitativeSentiment = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unclear'
export type QualitativeConfidence = 'low' | 'medium' | 'high'
export type QualitativeInfluence = 'improved' | 'worsened' | 'neutral' | 'unclear'
export type QualitativeControllability =
  | 'analyst'
  | 'company'
  | 'customer'
  | 'external'
  | 'mixed'
  | 'unclear'

export type QualitativeAnalystTakeaway =
  | 'maintain'
  | 'develop'
  | 'context'
  | 'none'

export type QualitativeCauseCategory =
  | 'system_or_product'
  | 'process'
  | 'wait_time'
  | 'communication'
  | 'resolution_quality'
  | 'customer_expectation'
  | 'external'
  | 'other'
  | 'unclear'

export type QualitativeCxCoaching = {
  negative_rating_hypothesis: string
  customer_experience_impact: string
  observable_analyst_behavior: string
  practice_to_improve: string
  suggested_phrase: string
  verification_check: string
  attribution_caution: string
  evidence_confidence: QualitativeConfidence
  source: 'generated' | 'contextual_from_existing_analysis'
}

export type ClickDeskQualitativeAnalysis = {
  initial_sentiment: QualitativeSentiment
  final_sentiment: QualitativeSentiment
  primary_cause: {
    category: QualitativeCauseCategory
    summary: string
    confidence: QualitativeConfidence
  }
  human_influence: {
    classification: QualitativeInfluence
    summary: string
    confidence: QualitativeConfidence
  }
  controllability: {
    classification: QualitativeControllability
    summary: string
  }
  coaching_signal: {
    available: boolean
    summary: string
  }
  analyst_takeaway: {
    kind: QualitativeAnalystTakeaway
    summary: string
    confidence: QualitativeConfidence
  }
  evidence_summary: string[]
  limitations: string[]
  cx_coaching: QualitativeCxCoaching
}

const SENTIMENT = new Set<QualitativeSentiment>([
  'positive',
  'neutral',
  'negative',
  'mixed',
  'unclear',
])
const CONFIDENCE = new Set<QualitativeConfidence>(['low', 'medium', 'high'])
const INFLUENCE = new Set<QualitativeInfluence>([
  'improved',
  'worsened',
  'neutral',
  'unclear',
])
const CONTROLLABILITY = new Set<QualitativeControllability>([
  'analyst',
  'company',
  'customer',
  'external',
  'mixed',
  'unclear',
])
const TAKEAWAY = new Set<QualitativeAnalystTakeaway>([
  'maintain',
  'develop',
  'context',
  'none',
])
const CAUSE = new Set<QualitativeCauseCategory>([
  'system_or_product',
  'process',
  'wait_time',
  'communication',
  'resolution_quality',
  'customer_expectation',
  'external',
  'other',
  'unclear',
])


export const QUALITATIVE_ANALYSIS_VERSION = 2
export const QUALITATIVE_MIN_TRANSCRIPT_CHARS = 40

export function isQualitativeTranscriptSufficient(
  transcript: string,
  minimum = QUALITATIVE_MIN_TRANSCRIPT_CHARS,
) {
  return transcript.trim().length >= minimum
}


export function qualitativeAnalysisVersion(value: unknown) {
  const source = record(value)
  const raw = source._analysis_version
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 0
}

export function shouldReuseQualitativeCache(
  validationStatus: string | null | undefined,
  analysisVersion = QUALITATIVE_ANALYSIS_VERSION,
) {
  return (
    // Descarte é uma decisão editorial, não uma falha da análise.
    (validationStatus === 'rejected' || analysisVersion >= QUALITATIVE_ANALYSIS_VERSION)
  )
}

export async function runQualitativeProviderFallback<T>(
  providers: Array<{
    name: string
    run: () => Promise<T | null>
  }>,
) {
  const errors: string[] = []

  for (const provider of providers) {
    try {
      const result = await provider.run()
      if (result) {
        return { result, errors, provider: provider.name }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${provider.name}: ${message}`)
    }
  }

  return { result: null as T | null, errors, provider: null as string | null }
}

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function shortText(value: unknown, fallback: string, max = 500) {
  return typeof value === 'string' && value.trim()
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : fallback
}

function stringArray(value: unknown, maxItems: number, maxLength = 500) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, maxLength))
    .slice(0, maxItems)
}

export function normalizeQualitativeAnalysis(value: unknown): ClickDeskQualitativeAnalysis {
  const source = record(value)
  const cause = record(source.primary_cause)
  const influence = record(source.human_influence)
  const controllability = record(source.controllability)
  const coaching = record(source.coaching_signal)
  const takeaway = record(source.analyst_takeaway)

  const initialSentiment = SENTIMENT.has(source.initial_sentiment as QualitativeSentiment)
    ? (source.initial_sentiment as QualitativeSentiment)
    : 'unclear'
  const finalSentiment = SENTIMENT.has(source.final_sentiment as QualitativeSentiment)
    ? (source.final_sentiment as QualitativeSentiment)
    : 'unclear'
  const causeCategory = CAUSE.has(cause.category as QualitativeCauseCategory)
    ? (cause.category as QualitativeCauseCategory)
    : 'unclear'
  const causeConfidence = CONFIDENCE.has(cause.confidence as QualitativeConfidence)
    ? (cause.confidence as QualitativeConfidence)
    : 'low'
  const influenceClassification = INFLUENCE.has(
    influence.classification as QualitativeInfluence,
  )
    ? (influence.classification as QualitativeInfluence)
    : 'unclear'
  const influenceConfidence = CONFIDENCE.has(
    influence.confidence as QualitativeConfidence,
  )
    ? (influence.confidence as QualitativeConfidence)
    : 'low'
  const controllabilityClassification = CONTROLLABILITY.has(
    controllability.classification as QualitativeControllability,
  )
    ? (controllability.classification as QualitativeControllability)
    : 'unclear'
  const coachingSupportedByControl =
    controllabilityClassification === 'analyst' ||
    controllabilityClassification === 'mixed'
  const coachingAvailable =
    coaching.available === true && coachingSupportedByControl

  const explicitTakeawayKind = TAKEAWAY.has(
    takeaway.kind as QualitativeAnalystTakeaway,
  )
    ? (takeaway.kind as QualitativeAnalystTakeaway)
    : null
  const derivedTakeawayKind: QualitativeAnalystTakeaway =
    coachingAvailable
      ? 'develop'
      : influenceClassification === 'improved'
        ? 'maintain'
        : influenceClassification === 'worsened' && coachingSupportedByControl
          ? 'develop'
          : ['company', 'customer', 'external'].includes(controllabilityClassification)
            ? 'context'
            : 'none'
  const takeawayKind = explicitTakeawayKind ?? derivedTakeawayKind
  const takeawayConfidence = CONFIDENCE.has(
    takeaway.confidence as QualitativeConfidence,
  )
    ? (takeaway.confidence as QualitativeConfidence)
    : takeawayKind === 'context'
      ? causeConfidence
      : takeawayKind === 'maintain' || takeawayKind === 'develop'
        ? influenceConfidence
        : 'low'

  const fallbackTakeawaySummary =
    takeawayKind === 'maintain'
      ? shortText(
          influence.summary,
          'Há uma atuação observável que vale manter, mas a conversa não permite atribuir sozinha o resultado da avaliação a esse comportamento.',
        )
      : takeawayKind === 'develop'
        ? coachingAvailable
          ? shortText(
              coaching.summary,
              'Há um comportamento observável sob seu controle que pode ser desenvolvido.',
            )
          : shortText(
              influence.summary,
              'Há um ponto observável sob seu controle que pode ser desenvolvido.',
            )
        : takeawayKind === 'context'
          ? shortText(
              controllability.summary,
              'O principal ponto observado estava fora do seu controle direto. O aprendizado aqui é separar contexto operacional de responsabilidade individual.',
            )
          : 'Esta conversa não traz evidência suficiente para indicar algo específico a manter ou desenvolver. Isso evita transformar hipótese em orientação pessoal.'

  // A oportunidade de experiência é diferente de afirmar um erro do analista.
  // Análises anteriores continuam legíveis com uma sugestão contextual explícita.
  const enhanced = record(source.cx_coaching)
  const previousSummary = shortText(cause.summary, 'o problema relatado no atendimento')
  const closureByInactivity = [
    ...stringArray(source.limitations, 5),
    ...stringArray(source.evidence_summary, 3),
    shortText(influence.summary, ''),
  ].some(item => /inatividade|encerrad[oa] automaticamente|sem confirma[cç][aã]o de solu[cç][aã]o|não é possível saber se/i.test(item))
  const contextualHypothesis = closureByInactivity
    ? 'O cliente pode ter ficado sem confirmação de que o problema foi resolvido após o encerramento por inatividade. É uma hipótese para a nota, não um motivo declarado pelo cliente.'
    : `O cliente pode ter avaliado negativamente a dificuldade associada a ${previousSummary}. O motivo exato da nota não foi declarado na evidência disponível.`
  const contextualPractice = closureByInactivity
    ? 'Em atendimentos semelhantes, convide o cliente a testar a solução, confirme o resultado e registre o próximo passo e a forma de retomada se a sessão encerrar. Isso não demonstra que o analista deixou de fazê-lo neste ticket.'
    : takeawayKind !== 'none'
      ? shortText(takeaway.summary, fallbackTakeawaySummary)
      : 'Em atendimento semelhante, identifique a necessidade do cliente, confirme a compreensão e combine a próxima ação verificável, sem presumir que essa etapa faltou nesta conversa.'
  const suggestedPhrase = closureByInactivity
    ? 'Entendi que a emissão está impedida. Após os procedimentos orientados, você consegue fazer um novo teste? Se o erro persistir, informe o código técnico do retorno para seguirmos. Deixarei os passos registrados caso seja necessário retomar.'
    : 'Quero confirmar se a orientação ajudou. Você consegue testar agora? Caso não resolva, vamos registrar o retorno técnico e definir o próximo passo.'
  const cxCoaching: QualitativeCxCoaching = {
    negative_rating_hypothesis: shortText(enhanced.negative_rating_hypothesis, contextualHypothesis),
    customer_experience_impact: shortText(
      enhanced.customer_experience_impact,
      closureByInactivity ? 'Possível insegurança pela falta de desfecho confirmado; percepção não explicitamente comprovada.' : 'Possível frustração com o problema, sem evidência direta do motivo da nota.',
    ),
    observable_analyst_behavior: shortText(enhanced.observable_analyst_behavior, shortText(influence.summary, 'A conversa não permite atribuir conduta específica ao analista.')),
    practice_to_improve: shortText(enhanced.practice_to_improve, contextualPractice),
    suggested_phrase: shortText(enhanced.suggested_phrase, suggestedPhrase),
    verification_check: shortText(enhanced.verification_check, 'Verificar na próxima amostra se o cliente testou o procedimento e se há um próximo passo registrado, sem presumir falha passada.'),
    attribution_caution: shortText(enhanced.attribution_caution, 'A causa técnica e a avaliação registrada não comprovam, por si só, que a conduta do analista provocou a nota.'),
    evidence_confidence: CONFIDENCE.has(enhanced.evidence_confidence as QualitativeConfidence)
      ? enhanced.evidence_confidence as QualitativeConfidence : 'low',
    source: enhanced.negative_rating_hypothesis && enhanced.practice_to_improve
      ? 'generated' : 'contextual_from_existing_analysis',
  }

  return {
    initial_sentiment: initialSentiment,
    final_sentiment: finalSentiment,
    primary_cause: {
      category: causeCategory,
      summary: shortText(cause.summary, 'Evidência insuficiente para atribuir uma causa.'),
      confidence: causeConfidence,
    },
    human_influence: {
      classification: influenceClassification,
      summary: shortText(
        influence.summary,
        'Evidência insuficiente para avaliar a influência do atendimento humano.',
      ),
      confidence: influenceConfidence,
    },
    controllability: {
      classification: controllabilityClassification,
      summary: shortText(
        controllability.summary,
        'Não foi possível determinar controlabilidade com segurança.',
      ),
    },
    coaching_signal: {
      available: coachingAvailable,
      summary: coachingAvailable
        ? shortText(
            coaching.summary,
            'Há um ponto observável sob controle do analista para trabalhar em feedback.',
          )
        : 'Sem evidência suficiente de um comportamento sob controle do analista para orientar feedback individual.',
    },
    analyst_takeaway: {
      kind: takeawayKind,
      summary: shortText(
        takeaway.summary,
        fallbackTakeawaySummary,
      ),
      confidence: takeawayConfidence,
    },
    evidence_summary: stringArray(source.evidence_summary, 3, 350),
    limitations: stringArray(source.limitations, 5, 350),
    cx_coaching: cxCoaching,
  }
}

export function redactTranscriptText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-\s]?\d{4}\b/g, '[telefone]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/\b\d{8,}\b/g, '[identificador]')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractTranscriptText(payload: unknown) {
  const lines: string[] = []
  const seen = new Set<string>()
  let totalLength = 0

  const add = (text: string, role?: string | null) => {
    const clean = redactTranscriptText(text)
    if (!clean || clean.length < 2 || seen.has(clean)) return
    const line = role ? `${role}: ${clean}` : clean
    const remaining = 30000 - totalLength
    if (remaining <= 0) return
    const clipped = line.slice(0, remaining)
    lines.push(clipped)
    seen.add(clean)
    totalLength += clipped.length
  }

  const visit = (value: unknown, depth = 0) => {
    if (value === null || value === undefined || depth > 7 || totalLength >= 30000) return

    if (typeof value === 'string') {
      if (depth === 0) add(value)
      return
    }

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 250)) visit(item, depth + 1)
      return
    }

    if (typeof value !== 'object') return

    const source = value as Record<string, unknown>
    const role =
      ['role', 'author_type', 'sender_type', 'actor_type', 'attendance', 'type']
        .map((key) => source[key])
        .find((item) => typeof item === 'string') as string | undefined

    for (const key of ['message', 'content', 'body', 'text']) {
      const raw = source[key]
      if (typeof raw === 'string') add(raw, role ?? null)
    }

    for (const raw of Object.values(source)) {
      if (raw && typeof raw === 'object') visit(raw, depth + 1)
    }
  }

  visit(payload)

  return lines.slice(0, 120).join('\n')
}

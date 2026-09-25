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
  evidence_summary: string[]
  limitations: string[]
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
      available: coaching.available === true,
      summary: shortText(
        coaching.summary,
        coaching.available === true
          ? 'Há um ponto observável para trabalhar em feedback.'
          : 'Sem evidência suficiente para orientar comportamento individual.',
      ),
    },
    evidence_summary: stringArray(source.evidence_summary, 3, 350),
    limitations: stringArray(source.limitations, 5, 350),
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

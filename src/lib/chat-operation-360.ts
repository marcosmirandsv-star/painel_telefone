export type Operation360Attendance = {
  clickdesk_ticket_id: string
  satisfaction_label: string | null
}

export type Operation360NormalizedAnalysis = {
  primary_cause: { category: string; summary: string }
  controllability: { classification: string; summary: string }
  human_influence: { classification: string; summary: string }
  analyst_takeaway: { kind: string; summary: string }
}

export type Operation360AnalysisRow = {
  clickdesk_ticket_id: string
  satisfaction_label: string | null
  validation_status: 'pending' | 'approved' | 'rejected'
  analysis: Operation360NormalizedAnalysis
}

export type Operation360Pattern = {
  key: string
  count: number
  percentage: number
  ticket_ids: string[]
  examples: string[]
}

export function operation360Percentage(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0
}

export function calculateOperation360Totals(rows: Operation360Attendance[]) {
  const positive = rows.filter((row) => row.satisfaction_label === 'positive').length
  const negative = rows.filter((row) => row.satisfaction_label === 'negative').length
  const evaluated = positive + negative

  return {
    attendances: rows.length,
    evaluated,
    positive,
    negative,
    csat: evaluated > 0 ? operation360Percentage(positive, evaluated) : null,
    review_percentage:
      rows.length > 0 ? operation360Percentage(evaluated, rows.length) : null,
  }
}

function buildPatterns(
  rows: Array<{
    ticket_id: string
    key: string
    example: string
  }>,
): Operation360Pattern[] {
  const total = rows.length
  const grouped = new Map<string, { count: number; ticketIds: string[]; examples: string[] }>()

  for (const row of rows) {
    const current = grouped.get(row.key) ?? { count: 0, ticketIds: [], examples: [] }
    current.count += 1

    if (current.ticketIds.length < 8 && !current.ticketIds.includes(row.ticket_id)) {
      current.ticketIds.push(row.ticket_id)
    }

    if (
      row.example &&
      current.examples.length < 3 &&
      !current.examples.includes(row.example)
    ) {
      current.examples.push(row.example)
    }

    grouped.set(row.key, current)
  }

  return [...grouped.entries()]
    .map(([key, value]) => ({
      key,
      count: value.count,
      percentage: operation360Percentage(value.count, total),
      ticket_ids: value.ticketIds,
      examples: value.examples,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function buildOperation360Analysis(
  rows: Operation360AnalysisRow[],
  status: 'approved' | 'analyzed' = 'approved',
) {
  const eligible =
    status === 'approved'
      ? rows.filter((row) => row.validation_status === 'approved')
      : rows.filter((row) => row.validation_status !== 'rejected')

  const normalized = eligible.map((row) => ({
    ticket_id: row.clickdesk_ticket_id,
    satisfaction_label: row.satisfaction_label,
    analysis: row.analysis,
  }))

  const summarize = (satisfaction: 'positive' | 'negative') => {
    const scoped = normalized.filter((row) => row.satisfaction_label === satisfaction)

    return {
      analyzed: scoped.length,
      causes: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.primary_cause.category,
          example: row.analysis.primary_cause.summary,
        })),
      ),
      controllability: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.controllability.classification,
          example: row.analysis.controllability.summary,
        })),
      ),
      human_influence: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.human_influence.classification,
          example: row.analysis.human_influence.summary,
        })),
      ),
      takeaways: buildPatterns(
        scoped.map((row) => ({
          ticket_id: row.ticket_id,
          key: row.analysis.analyst_takeaway.kind,
          example: row.analysis.analyst_takeaway.summary,
        })),
      ),
    }
  }

  return {
    status,
    total: normalized.length,
    negative: summarize('negative'),
    positive: summarize('positive'),
  }
}


export type Operation360Synthesis = {
  coverage_level: 'none' | 'initial' | 'partial' | 'strong'
  coverage_label: string
  headline: string
  negative_read: string
  control_read: string
  positive_read: string
  result_read: string
  caveat: string
}

const OPERATION_360_LABELS: Record<string, string> = {
  system_or_product: 'sistema ou produto',
  process: 'processo',
  wait_time: 'tempo de espera',
  communication: 'comunicação',
  resolution_quality: 'qualidade da resolução',
  customer_expectation: 'expectativa do cliente',
  external: 'fator externo',
  other: 'outros fatores',
  unclear: 'causa inconclusiva',
  analyst: 'atendimento',
  company: 'empresa ou processo interno',
  customer: 'cliente',
  mixed: 'fatores mistos',
  maintain: 'prática a manter',
  develop: 'ponto a desenvolver',
  context: 'contexto fora do controle direto',
  none: 'sem aprendizado específico',
}

function operation360Label(key?: string) {
  if (!key) return 'sem padrão predominante'
  return OPERATION_360_LABELS[key] ?? key.replace(/_/g, ' ')
}

function strongestPattern(patterns: Operation360Pattern[]) {
  return patterns.find((pattern) => pattern.key !== 'unclear') ?? patterns[0] ?? null
}

function coverageLevel(analyzed: number, total: number): Operation360Synthesis['coverage_level'] {
  if (analyzed <= 0 || total <= 0) return 'none'
  const percentage = operation360Percentage(analyzed, total)
  if (analyzed < 5 || percentage < 35) return 'initial'
  if (percentage < 75) return 'partial'
  return 'strong'
}

export function buildOperation360Synthesis(input: {
  negativeTotal: number
  positiveTotal: number
  analysis: ReturnType<typeof buildOperation360Analysis>
}): Operation360Synthesis {
  const negativeAnalyzed = input.analysis.negative.analyzed
  const positiveAnalyzed = input.analysis.positive.analyzed
  const negativeCoverage = operation360Percentage(negativeAnalyzed, input.negativeTotal)
  const positiveCoverage = operation360Percentage(positiveAnalyzed, input.positiveTotal)
  const level = coverageLevel(negativeAnalyzed, input.negativeTotal)
  const topNegative = strongestPattern(input.analysis.negative.causes)
  const topControl = strongestPattern(input.analysis.negative.controllability)
  const topPositiveTakeaway = strongestPattern(input.analysis.positive.takeaways)
  const topPositiveCause = strongestPattern(input.analysis.positive.causes)

  const coverageLabel =
    level === 'strong'
      ? 'Cobertura forte'
      : level === 'partial'
        ? 'Cobertura parcial'
        : level === 'initial'
          ? 'Cobertura inicial'
          : 'Sem cobertura'

  const headline =
    input.negativeTotal === 0
      ? 'Não há avaliações negativas neste recorte.'
      : negativeAnalyzed === 0
        ? `Há ${input.negativeTotal} avaliação(ões) negativa(s), mas a IA ainda não possui leituras válidas para consolidar padrões.`
        : `A IA já leu ${negativeAnalyzed} de ${input.negativeTotal} avaliação(ões) negativa(s) (${negativeCoverage}%).`

  const negativeRead =
    !topNegative
      ? 'Ainda não há base analisada suficiente para apontar um padrão negativo.'
      : `Entre as negativas já analisadas, o fator mais recorrente é ${operation360Label(topNegative.key)}: ${topNegative.count} ocorrência(s), equivalentes a ${topNegative.percentage}% da leitura disponível.`

  const controlRead =
    !topControl
      ? 'Ainda não é possível separar com segurança o que estava sob controle do atendimento e o que pertence ao contexto.'
      : `Na dimensão de controlabilidade, o agrupamento mais frequente está em ${operation360Label(topControl.key)} (${topControl.count} ocorrência(s)). Esse recorte ajuda a separar o que aparece ligado ao atendimento do que aparece ligado ao contexto da operação.`

  const positivePattern = topPositiveCause ?? topPositiveTakeaway
  const positiveRead =
    positiveAnalyzed === 0 || !positivePattern
      ? 'As avaliações positivas ainda não têm cobertura suficiente para consolidar uma prática recorrente.'
      : `Nas positivas analisadas (${positiveAnalyzed} de ${input.positiveTotal}; ${positiveCoverage}%), o fator mais recorrente é ${operation360Label(positivePattern.key)}. Esse dado descreve uma recorrência observada e, isoladamente, não prova a causa da avaliação positiva.`

  const resultRead =
    input.negativeTotal === 0
      ? 'Neste recorte, não há avaliações negativas pressionando o CSAT.'
      : negativeAnalyzed === 0
        ? `O período reúne ${input.negativeTotal} avaliação(ões) negativa(s), mas ainda não há leitura qualitativa suficiente para explicar quais fatores se repetem nelas.`
        : topNegative && topControl
          ? `Na leitura disponível, as negativas se concentram principalmente em ${operation360Label(topNegative.key)} (${topNegative.count} ocorrência(s)); na dimensão de contexto, ${operation360Label(topControl.key)} é o agrupamento mais frequente (${topControl.count} ocorrência(s)).`
          : topNegative
            ? `Na leitura disponível, o padrão negativo mais recorrente é ${operation360Label(topNegative.key)} (${topNegative.count} ocorrência(s)).`
            : 'A leitura disponível ainda não mostra um fator predominante entre as avaliações negativas.'

  return {
    coverage_level: level,
    coverage_label: coverageLabel,
    headline,
    negative_read: negativeRead,
    control_read: controlRead,
    positive_read: positiveRead,
    result_read: resultRead,
    caveat:
      'A síntese descreve padrões dos tickets já analisados. Recorrência não prova causalidade e cobertura parcial não representa automaticamente toda a operação.',
  }
}

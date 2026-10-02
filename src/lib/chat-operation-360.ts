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
    review_percentage: rows.length > 0 ? operation360Percentage(evaluated, rows.length) : null,
  }
}

function buildPatterns(
  rows: Array<{ ticket_id: string; key: string; example: string }>,
): Operation360Pattern[] {
  const total = rows.length
  const grouped = new Map<string, { count: number; ticketIds: string[]; examples: string[] }>()

  for (const row of rows) {
    const current = grouped.get(row.key) ?? { count: 0, ticketIds: [], examples: [] }
    current.count += 1
    if (current.ticketIds.length < 8 && !current.ticketIds.includes(row.ticket_id)) current.ticketIds.push(row.ticket_id)
    if (row.example && current.examples.length < 3 && !current.examples.includes(row.example)) current.examples.push(row.example)
    grouped.set(row.key, current)
  }

  return [...grouped.entries()]
    .map(([key, value]) => ({ key, count: value.count, percentage: operation360Percentage(value.count, total), ticket_ids: value.ticketIds, examples: value.examples }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function buildOperation360Analysis(rows: Operation360AnalysisRow[], status: 'approved' | 'analyzed' = 'approved') {
  const eligible = status === 'approved' ? rows.filter((row) => row.validation_status === 'approved') : rows.filter((row) => row.validation_status !== 'rejected')
  const normalized = eligible.map((row) => ({ ticket_id: row.clickdesk_ticket_id, satisfaction_label: row.satisfaction_label, analysis: row.analysis }))

  const summarize = (satisfaction: 'positive' | 'negative') => {
    const scoped = normalized.filter((row) => row.satisfaction_label === satisfaction)
    return {
      analyzed: scoped.length,
      causes: buildPatterns(scoped.map((row) => ({ ticket_id: row.ticket_id, key: row.analysis.primary_cause.category, example: row.analysis.primary_cause.summary }))),
      controllability: buildPatterns(scoped.map((row) => ({ ticket_id: row.ticket_id, key: row.analysis.controllability.classification, example: row.analysis.controllability.summary }))),
      human_influence: buildPatterns(scoped.map((row) => ({ ticket_id: row.ticket_id, key: row.analysis.human_influence.classification, example: row.analysis.human_influence.summary }))),
      takeaways: buildPatterns(scoped.map((row) => ({ ticket_id: row.ticket_id, key: row.analysis.analyst_takeaway.kind, example: row.analysis.analyst_takeaway.summary }))),
    }
  }

  return { status, total: normalized.length, negative: summarize('negative'), positive: summarize('positive') }
}

export type Operation360Synthesis = {
  coverage_level: 'none' | 'initial' | 'partial' | 'strong'
  coverage_label: string
  headline: string
  negative_read: string
  control_read: string
  positive_read: string
  result_read: string
  recommended_focus: string
  caveat: string
}

const OPERATION_360_LABELS: Record<string, string> = {
  system_or_product: 'sistema ou produto', process: 'processo', wait_time: 'tempo de espera', communication: 'comunicação', resolution_quality: 'qualidade da resolução', customer_expectation: 'expectativa do cliente', external: 'fator externo', other: 'outros fatores', unclear: 'causa inconclusiva', analyst: 'atendimento', company: 'empresa ou processo interno', customer: 'cliente', mixed: 'fatores mistos', maintain: 'prática a manter', develop: 'ponto a desenvolver', context: 'contexto fora do controle direto', none: 'sem aprendizado específico',
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

function concreteExamples(pattern: Operation360Pattern | null, limit = 3) {
  if (!pattern) return ''
  const examples = pattern.examples.map((value) => value.trim()).filter(Boolean).slice(0, limit)
  if (!examples.length) return ''
  return examples.join(' | ')
}

function patternWithMeaning(pattern: Operation360Pattern | null) {
  if (!pattern) return 'sem padrão predominante'
  const examples = concreteExamples(pattern)
  return `${operation360Label(pattern.key)} (${pattern.count} ocorrência(s))${examples ? `. O que aparece nos tickets: ${examples}` : ''}`
}

function isDominantPattern(pattern: Operation360Pattern | null) {
  if (!pattern) return false
  return pattern.count >= 3 && pattern.percentage >= 40
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
  const totalEvaluated = input.negativeTotal + input.positiveTotal
  const totalAnalyzed = negativeAnalyzed + positiveAnalyzed
  const overallCoverage = operation360Percentage(totalAnalyzed, totalEvaluated)
  const level = coverageLevel(totalAnalyzed, totalEvaluated)
  const positiveLevel = coverageLevel(positiveAnalyzed, input.positiveTotal)
  const topNegative = strongestPattern(input.analysis.negative.causes)
  const topControl = strongestPattern(input.analysis.negative.controllability)
  const topPositiveTakeaway = strongestPattern(input.analysis.positive.takeaways)
  const topPositiveCause = strongestPattern(input.analysis.positive.causes)

  const coverageLabel = level === 'strong' ? 'Cobertura forte' : level === 'partial' ? 'Cobertura parcial' : level === 'initial' ? 'Cobertura inicial' : 'Análise pendente'

  const headline = input.negativeTotal === 0
    ? 'Não há avaliações negativas neste recorte.'
    : negativeAnalyzed === 0
      ? `Existem ${input.negativeTotal} avaliação(ões) negativa(s), mas nenhuma delas foi processada qualitativamente pela IA neste recorte.`
      : `A IA processou ${totalAnalyzed} de ${totalEvaluated} avaliação(ões) do recorte (${overallCoverage}%). Entre as negativas, foram ${negativeAnalyzed} de ${input.negativeTotal} (${negativeCoverage}%). A síntese abaixo descreve somente a parcela processada.`

  const negativeRead = !topNegative
    ? negativeAnalyzed === 0 ? 'As avaliações negativas ainda aguardam processamento qualitativo.' : 'A parcela já analisada ainda não mostra um fator negativo recorrente.'
    : isDominantPattern(topNegative)
      ? `Na parcela analisada, há concentração em ${patternWithMeaning(topNegative)}.`
      : `Na parcela analisada, ainda não há concentração dominante. O agrupamento mais frequente é ${patternWithMeaning(topNegative)}, representando ${topNegative.percentage}% dos tickets negativos já processados.`

  const controlRead = !topControl
    ? 'Ainda não é possível separar com segurança o que estava sob controle do atendimento e o que pertence ao contexto.'
    : `Quanto à responsabilidade/contexto, aparece com maior frequência ${patternWithMeaning(topControl)}.`

  const positivePattern = topPositiveCause ?? topPositiveTakeaway
  const positiveRead = positiveAnalyzed === 0 || !positivePattern
    ? input.positiveTotal > 0 ? `Existem ${input.positiveTotal} avaliação(ões) positiva(s), mas ainda não há leitura qualitativa processada suficiente para explicar o que funcionou.` : 'Não há avaliações positivas neste recorte.'
    : positiveLevel === 'initial'
      ? `A IA processou apenas ${positiveAnalyzed} de ${input.positiveTotal} positiva(s) (${positiveCoverage}%). A amostra positiva ainda é inicial e não deve ser generalizada. Entre os tickets já lidos aparece ${patternWithMeaning(positivePattern)}.`
      : `A IA processou ${positiveAnalyzed} de ${input.positiveTotal} positiva(s) (${positiveCoverage}%). O agrupamento mais frequente é ${patternWithMeaning(positivePattern)}.`

  const lowCoveragePrefix = level === 'strong' ? '' : `Leitura parcial (${totalAnalyzed}/${totalEvaluated} avaliações processadas; ${negativeAnalyzed}/${input.negativeTotal} negativas). `
  const resultRead = input.negativeTotal === 0
    ? 'Neste recorte, não há avaliações negativas pressionando o CSAT.'
    : negativeAnalyzed === 0
      ? `Há ${input.negativeTotal} avaliação(ões) negativa(s), porém a análise qualitativa ainda não foi executada para esses tickets. Não é possível explicar o resultado antes do processamento.`
      : topNegative && topControl
        ? `${lowCoveragePrefix}${isDominantPattern(topNegative) ? 'Há concentração no agrupamento negativo' : 'O agrupamento negativo mais frequente, sem dominância na amostra, é'} ${patternWithMeaning(topNegative)}. Na dimensão de responsabilidade/contexto, o agrupamento mais frequente é ${patternWithMeaning(topControl)}.`
        : topNegative
          ? `${lowCoveragePrefix}${isDominantPattern(topNegative) ? 'Há concentração no agrupamento negativo' : 'O agrupamento negativo mais frequente, sem dominância na amostra, é'} ${patternWithMeaning(topNegative)}.`
          : `${lowCoveragePrefix}A parcela analisada ainda não mostra um fator predominante.`

  return {
    coverage_level: level,
    coverage_label: coverageLabel,
    headline,
    negative_read: negativeRead,
    control_read: controlRead,
    positive_read: positiveRead,
    result_read: resultRead,
    recommended_focus: resultRead,
    caveat: level === 'strong'
      ? 'A síntese descreve recorrências observadas nos tickets analisados. Recorrência não prova causalidade; consulte as evidências antes de concluir responsabilidade.'
      : 'Cobertura incompleta: a síntese não representa automaticamente todas as avaliações do período. Recorrência não prova causalidade. Os tickets pendentes precisam ser processados antes de uma conclusão consolidada.',
  }
}

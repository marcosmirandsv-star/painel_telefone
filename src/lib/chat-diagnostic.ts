export type ChatPerformanceDiagnosticInput = {
  csat: number | null
  csatGoal: number | null
  reviewPercentage: number | null
  reviewGoal?: number
  positiveReviews?: number
  negativeReviews?: number
  attendances?: number
}

export type ChatPerformanceDiagnostic = {
  status: 'success' | 'attention' | 'priority' | 'partial'
  statusLabel: string
  goalsMet: number
  goalsEvaluated: number
  totalGoals: 2
  csatMet: boolean | null
  reviewMet: boolean | null
  csatDelta: number | null
  reviewDelta: number | null
  summary: string
  strength: { title: string; detail: string }
  attention: { title: string; detail: string }
  priority: { title: string; detail: string }
  methodNote: string
}

function round(value: number) {
  return Math.round(value * 100) / 100
}

function validNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function percent(value: number) {
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`
}

function pp(value: number) {
  return `${Math.abs(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} p.p.`
}

function aboveOrBelow(delta: number) {
  return delta >= 0 ? `${pp(delta)} acima` : `${pp(delta)} abaixo`
}

export function buildChatPerformanceDiagnostic({
  csat,
  csatGoal,
  reviewPercentage,
  reviewGoal = 25,
  positiveReviews = 0,
  negativeReviews = 0,
  attendances = 0,
}: ChatPerformanceDiagnosticInput): ChatPerformanceDiagnostic {
  const hasCsatGoal = validNumber(csatGoal)
  const hasCsat = validNumber(csat)
  const hasReview = validNumber(reviewPercentage)
  const csatDelta = hasCsatGoal && hasCsat ? round(csat - csatGoal) : null
  const reviewDelta = hasReview ? round(reviewPercentage - reviewGoal) : null
  const csatMet = csatDelta === null ? null : csatDelta >= 0
  const reviewMet = reviewDelta === null ? null : reviewDelta >= 0
  const goalsEvaluated = Number(csatMet !== null) + Number(reviewMet !== null)
  const goalsMet = Number(csatMet === true) + Number(reviewMet === true)

  let status: ChatPerformanceDiagnostic['status'] = 'partial'
  let statusLabel = 'Leitura parcial'

  if (goalsEvaluated === 2) {
    if (goalsMet === 2) {
      status = 'success'
      statusLabel = 'Dentro das metas'
    } else if (goalsMet === 1) {
      status = 'attention'
      statusLabel = 'Atenção'
    } else {
      status = 'priority'
      statusLabel = 'Prioridade'
    }
  }

  let summary = 'Ainda não há base suficiente para avaliar as duas metas.'
  if (!hasCsatGoal) {
    summary = 'A meta individual de CSAT ainda não está configurada para este analista.'
  } else if (goalsEvaluated === 2) {
    const csatText = `CSAT ${percent(csat!)} (${aboveOrBelow(csatDelta!)} da meta de ${percent(csatGoal)})`
    const reviewText = `avaliações ${percent(reviewPercentage!)} (${aboveOrBelow(reviewDelta!)} da meta de ${percent(reviewGoal)})`
    summary = `${goalsMet} de 2 metas atingidas. ${csatText}; ${reviewText}.`
  } else if (hasReview && !hasCsat) {
    summary = `A participação nas avaliações está em ${percent(reviewPercentage)}, mas ainda não há avaliações suficientes para calcular o CSAT.`
  } else if (hasCsat && !hasReview) {
    summary = `O CSAT está em ${percent(csat)}, mas ainda não há base para calcular a participação nas avaliações.`
  }

  let strength = {
    title: 'Sem ponto forte por meta neste recorte',
    detail: 'Nenhum dos dois indicadores avaliados está acima da respectiva meta.',
  }

  if (csatMet === true && reviewMet === true) {
    const csatMargin = csatDelta ?? 0
    const reviewMargin = reviewDelta ?? 0
    strength =
      csatMargin >= reviewMargin
        ? {
            title: 'Satisfação registrada pelos clientes',
            detail: `CSAT em ${percent(csat!)}: ${pp(csatMargin)} acima da meta.`,
          }
        : {
            title: 'Participação nas avaliações',
            detail: `Avaliações em ${percent(reviewPercentage!)}: ${pp(reviewMargin)} acima da meta.`,
          }
  } else if (csatMet === true) {
    strength = {
      title: 'Satisfação registrada pelos clientes',
      detail: `CSAT em ${percent(csat!)}: ${pp(csatDelta ?? 0)} acima da meta.`,
    }
  } else if (reviewMet === true) {
    strength = {
      title: 'Participação nas avaliações',
      detail: `Avaliações em ${percent(reviewPercentage!)}: ${pp(reviewDelta ?? 0)} acima da meta.`,
    }
  } else if (goalsEvaluated < 2) {
    strength = {
      title: 'Base ainda parcial',
      detail: 'O painel ainda não possui os dois indicadores necessários para apontar um ponto forte por meta.',
    }
  }

  let attention = {
    title: 'Nenhum indicador abaixo da meta',
    detail: 'CSAT e participação nas avaliações estão dentro das referências atuais.',
  }

  if (csatMet === false && reviewMet === false) {
    attention = {
      title: 'CSAT e participação nas avaliações',
      detail: `CSAT está ${pp(csatDelta ?? 0)} abaixo da meta e avaliações estão ${pp(reviewDelta ?? 0)} abaixo da meta.`,
    }
  } else if (csatMet === false) {
    attention = {
      title: 'Satisfação do cliente',
      detail: `O CSAT está ${pp(csatDelta ?? 0)} abaixo da meta individual de ${percent(csatGoal!)}.`,
    }
  } else if (reviewMet === false) {
    attention = {
      title: 'Participação nas avaliações',
      detail: `O percentual de avaliações está ${pp(reviewDelta ?? 0)} abaixo da meta de ${percent(reviewGoal)}.`,
    }
  } else if (goalsEvaluated < 2) {
    attention = {
      title: 'Completar a leitura',
      detail: 'Ainda falta base para avaliar as duas metas de forma conjunta.',
    }
  }

  let priority = {
    title: 'Manter acompanhamento',
    detail: 'Os dois indicadores estão dentro das metas; acompanhe a estabilidade ao longo da competência.',
  }

  if (csatMet === false) {
    const negativeDetail =
      negativeReviews > 0
        ? `Há ${negativeReviews} avaliação${negativeReviews === 1 ? '' : 'ões'} negativa${negativeReviews === 1 ? '' : 's'} no recorte.`
        : 'O recorte não possui contagem de avaliações negativas disponível.'

    priority = {
      title:
        reviewMet === false
          ? 'Entender qualidade e base de avaliações'
          : 'Entender o que está pressionando o CSAT',
      detail: `${negativeDetail} Esse é o recorte prioritário para investigação de causa antes de atribuir comportamento ou definir ação.`,
    }
  } else if (reviewMet === false) {
    priority = {
      title: 'Entender a baixa participação nas avaliações',
      detail: `Apenas ${percent(reviewPercentage ?? 0)} dos ${attendances} atendimentos recebeu avaliação. O indicador precisa de uma base mais representativa antes de conclusões mais fortes.`,
    }
  } else if (goalsEvaluated < 2) {
    priority = {
      title: 'Completar a base mensurável',
      detail: 'A próxima leitura deve ocorrer quando os dois indicadores estiverem disponíveis.',
    }
  }

  return {
    status,
    statusLabel,
    goalsMet,
    goalsEvaluated,
    totalGoals: 2,
    csatMet,
    reviewMet,
    csatDelta,
    reviewDelta,
    summary,
    strength,
    attention,
    priority,
    methodNote:
      'Leitura calculada pelas metas e avaliações registradas no ClickDesk. Ainda não é análise de sentimento ou causa feita por IA.',
  }
}

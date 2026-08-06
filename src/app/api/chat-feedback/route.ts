import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ChatFeedbackRequest = {
  feedbackStyle?: 'coach' | 'sare' | 'mimo'
  periodLabel?: string
  managerNotes?: string
  fallbackText?: string
  averageTickets?: number
  podiumPosition?: number
  metric?: {
    analystName?: string
    teamName?: string
    csat?: number
    reviewPercentage?: number
    sendingPercentage?: number
    totalTickets?: number
    inactiveTickets?: number
    validTickets?: number
    reviews?: number
    positiveReviews?: number
    negativeReviews?: number
    csatGoal?: number
    reviewGoal?: number
    status?: string | null
  }
  monthlyHistory?: {
    monthLabel: string
    csat: number
    reviewPercentage: number
    sendingPercentage: number
    totalTickets: number
  }[]
}

const styleInstructions = {
  coach:
    'Use formato Coach com seÃ§Ãµes: Leitura do ciclo, ForÃ§as observadas, Plano de desenvolvimento, Expectativa para o prÃ³ximo ciclo mensal.',
  sare:
    'Use formato SARE com seÃ§Ãµes: SituaÃ§Ã£o, Alinhamentos Realizados, Resultado Esperado, Expectativa e Plano de Desenvolvimento.',
  mimo:
    'Use formato MIMO com seÃ§Ãµes: Momento observado, Impacto, Melhoria ou manutenÃ§Ã£o, OrientaÃ§Ã£o.',
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Erro inesperado ao gerar feedback com IA.'
}

function extractText(data: unknown) {
  const response = data as {
    output_text?: string
    output?: {
      content?: {
        text?: string
      }[]
    }[]
  }

  if (typeof response.output_text === 'string') return response.output_text

  return (
    response.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text)
      .filter(Boolean)
      .join('\n') ?? ''
  )
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY nao configurada. Adicione a chave nas variaveis de ambiente para usar a IA.' },
      { status: 503 },
    )
  }

  try {
    const body = (await request.json()) as ChatFeedbackRequest
    const metric = body.metric

    if (!metric?.analystName) {
      return NextResponse.json({ error: 'Dados do analista nao foram enviados para a IA.' }, { status: 400 })
    }

    const feedbackStyle = body.feedbackStyle ?? 'coach'
    const model = process.env.OPENAI_MODEL || 'gpt-5.6-terra'
    const input = `
Voce e um coach senior de atendimento ao cliente e deve escrever um feedback profissional, humano e objetivo para um relatorio mensal individual do time de chat.

Regras:
- Escreva em portugues do Brasil.
- Nao diga para acompanhar semanalmente, porque o modulo do chat e analisado mensalmente.
- Use linguagem de desenvolvimento profissional, sem soar generico ou tecnico demais.
- Preserve os numeros; nao invente dados.
- Nao exponha raciocinio interno.
- Traga reconhecimento quando houver pontos fortes e plano pratico quando houver oportunidade.
- Mantenha entre 180 e 280 palavras.
- ${styleInstructions[feedbackStyle]}

Periodo: ${body.periodLabel ?? 'Periodo nao informado'}
Analista: ${metric.analystName}
Equipe: ${metric.teamName ?? 'Equipe nao informada'}
Status: ${metric.status ?? 'Nao informado'}
CSAT: ${metric.csat}% | Meta CSAT: ${metric.csatGoal}%
Avaliacoes: ${metric.reviewPercentage}% | Meta avaliacoes: ${metric.reviewGoal ?? 25}%
Envio/sem avaliacao: ${metric.sendingPercentage}%
Atendimentos totais: ${metric.totalTickets}
Atendimentos inativos: ${metric.inactiveTickets}
Atendimentos validos: ${metric.validTickets}
Avaliacoes recebidas: ${metric.reviews}
Positivas: ${metric.positiveReviews}
Negativas: ${metric.negativeReviews}
Media de atendimentos da operacao: ${body.averageTickets}
Posicao no podio: ${body.podiumPosition && body.podiumPosition > 0 ? `${body.podiumPosition}o lugar` : 'fora do podio'}

Historico mensal:
${JSON.stringify(body.monthlyHistory ?? [], null, 2)}

Observacoes do gestor:
${body.managerNotes?.trim() || 'Sem observacoes adicionais.'}

Texto base do sistema, caso ajude:
${body.fallbackText ?? ''}
`

    const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input,
        max_output_tokens: 900,
        reasoning: { effort: 'low' },
        text: { verbosity: 'medium' },
        store: false,
      }),
    })

    const data = await openAiResponse.json()

    if (!openAiResponse.ok) {
      const message = data?.error?.message || 'Nao foi possivel gerar feedback com IA.'
      return NextResponse.json({ error: message }, { status: openAiResponse.status })
    }

    const feedback = extractText(data).trim()

    if (!feedback) {
      return NextResponse.json({ error: 'A IA nao retornou texto para o feedback.' }, { status: 502 })
    }

    return NextResponse.json({ feedback })
  } catch (error) {
    return NextResponse.json({ error: getErrorText(error) }, { status: 500 })
  }
}


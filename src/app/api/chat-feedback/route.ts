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
    'Use formato Coach com secoes: Leitura do ciclo, Forcas observadas, Plano de desenvolvimento, Expectativa para o proximo ciclo mensal.',
  sare:
    'Use formato SARE com secoes: Situacao, Alinhamentos Realizados, Resultado Esperado, Expectativa e Plano de Desenvolvimento.',
  mimo:
    'Use formato MIMO com secoes: Momento observado, Impacto, Melhoria ou manutencao, Orientacao.',
}

function getErrorText(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Erro inesperado ao gerar feedback com IA.'
}

function buildPrompt(body: ChatFeedbackRequest) {
  const metric = body.metric
  const feedbackStyle = body.feedbackStyle ?? 'coach'

  return `
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
Analista: ${metric?.analystName}
Equipe: ${metric?.teamName ?? 'Equipe nao informada'}
Status: ${metric?.status ?? 'Nao informado'}
CSAT: ${metric?.csat}% | Meta CSAT: ${metric?.csatGoal}%
Avaliacoes: ${metric?.reviewPercentage}% | Meta avaliacoes: ${metric?.reviewGoal ?? 25}%
Envio/sem avaliacao: ${metric?.sendingPercentage}%
Atendimentos totais: ${metric?.totalTickets}
Atendimentos inativos: ${metric?.inactiveTickets}
Atendimentos validos: ${metric?.validTickets}
Avaliacoes recebidas: ${metric?.reviews}
Positivas: ${metric?.positiveReviews}
Negativas: ${metric?.negativeReviews}
Media de atendimentos da operacao: ${body.averageTickets}
Posicao no podio: ${body.podiumPosition && body.podiumPosition > 0 ? `${body.podiumPosition}o lugar` : 'fora do podio'}

Historico mensal:
${JSON.stringify(body.monthlyHistory ?? [], null, 2)}

Observacoes do gestor:
${body.managerNotes?.trim() || 'Sem observacoes adicionais.'}

Texto base do sistema, caso ajude:
${body.fallbackText ?? ''}
`
}

function extractChatCompletionText(data: unknown) {
  const response = data as {
    choices?: {
      message?: {
        content?: string
      }
    }[]
  }

  return response.choices?.[0]?.message?.content ?? ''
}

async function generateWithGitHubModels(prompt: string) {
  const token = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN

  if (!token) {
    throw new Error('GITHUB_MODELS_TOKEN nao configurado. Adicione na Vercel um token do GitHub com permissao models: read.')
  }

  const response = await fetch('https://models.github.ai/inference/chat/completions', {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      model: process.env.GITHUB_MODELS_MODEL || 'openai/gpt-4.1',
      messages: [
        {
          role: 'system',
          content: 'Voce escreve feedbacks profissionais para relatorios mensais de atendimento.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
      max_tokens: 900,
    }),
  })
  const data = await response.json()

  if (!response.ok) {
    const message = data?.message || data?.error?.message || 'Nao foi possivel gerar feedback com GitHub Models.'
    throw new Error(message)
  }

  return extractChatCompletionText(data).trim()
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatFeedbackRequest

    if (!body.metric?.analystName) {
      return NextResponse.json({ error: 'Dados do analista nao foram enviados para a IA.' }, { status: 400 })
    }

    const fallbackFeedback = body.fallbackText?.trim()

    if (!fallbackFeedback) {
      return NextResponse.json(
        {
          error:
            'Nao ha texto base suficiente para gerar o feedback. Gere uma sugestao local antes de exportar.',
        },
        { status: 400 },
      )
    }

    if (process.env.CHAT_AI_PROVIDER === 'github-models') {
      try {
        const prompt = buildPrompt(body)
        const feedback = await generateWithGitHubModels(prompt)

        if (feedback) {
          return NextResponse.json({ feedback, source: 'external-ai' })
        }
      } catch (providerError) {
        console.warn('Chat feedback external AI unavailable:', getErrorText(providerError))
      }
    }

    return NextResponse.json({
      feedback: fallbackFeedback,
      source: 'local-fallback',
      warning:
        'A IA externa nao esta disponivel no momento. Usei a sugestao local baseada nos numeros do Zendesk e nas regras do painel.',
    })
  } catch (error) {
    return NextResponse.json({ error: getErrorText(error) }, { status: 500 })
  }
}


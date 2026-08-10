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

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, 'Bearer ***')
    .replace(/[0-9A-Za-z_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPublicProviderError(error: unknown) {
  const message = sanitizeProviderMessage(getErrorText(error))

  if (/GEMINI_API_KEY nao configurada/i.test(message)) {
    return 'a variável GEMINI_API_KEY não chegou ao deploy ativo.'
  }

  if (/curto|incompleto|truncado|MAX_TOKENS/i.test(message)) {
    return 'a Gemini respondeu, mas o texto veio curto ou incompleto e foi bloqueado para proteger o relatório.'
  }

  if (/Nenhum modelo Gemini/i.test(message)) {
    return message.slice(0, 420)
  }

  return `Gemini respondeu: ${message.slice(0, 320)}`
}

function buildPrompt(body: ChatFeedbackRequest) {
  const metric = body.metric
  const feedbackStyle = body.feedbackStyle ?? 'coach'

  return `
Voce e um coach senior de atendimento ao cliente e editor de relatorios de performance. Sua tarefa principal e melhorar o texto base do sistema, preservando a estrutura, os numeros e a logica calculada, mas elevando a qualidade humana, gerencial e pratica da devolutiva.

Regras obrigatorias:
- Escreva em portugues do Brasil.
- Nao diga para acompanhar semanalmente, porque o modulo do chat e analisado mensalmente.
- Nao comece com parabens generico. Comece com uma leitura profissional do ciclo.
- Use o texto base do sistema como esqueleto obrigatorio; refine, aprofunde e humanize, mas nao substitua por um texto curto.
- Preserve todos os numeros relevantes; nao invente dados e nao mude calculos.
- Nao use Markdown, asteriscos, bullets soltos ou titulos decorativos. Escreva em texto limpo, com nomes de secoes seguidos de dois-pontos.
- Mantenha todas as secoes do modelo escolhido e escreva pelo menos 2 frases em cada secao.
- Transforme as observacoes do gestor em contexto de gestao; nao copie literalmente e ignore observacoes que sejam apenas teste tecnico.
- Traga reconhecimento especifico quando houver pontos fortes, conectando o elogio ao comportamento observado.
- Traga orientacao pratica: diga o que o analista deve repetir, observar, ajustar ou levar como evidencia no proximo fechamento mensal.
- Nao termine frase pela metade. Entregue um texto completo, pronto para colar no relatorio.
- Mantenha entre 260 e 380 palavras.
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

Texto base do sistema que deve ser melhorado e preservado como estrutura:
${body.fallbackText ?? ''}

Saida esperada:
Entregue apenas o feedback final, sem introducao, sem comentarios sobre a tarefa e sem Markdown.
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

function extractGeminiText(data: unknown) {
  const response = data as {
    candidates?: {
      content?: {
        parts?: {
          text?: string
        }[]
      }
      finishReason?: string
    }[]
  }

  const candidate = response.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? ''

  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('A Gemini devolveu um texto incompleto. Usei a sugestao local para evitar relatorio truncado.')
  }

  return text
}

function cleanFeedbackText(text: string) {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function assertCompleteFeedback(text: string, style: ChatFeedbackRequest['feedbackStyle']) {
  const cleanText = cleanFeedbackText(text)
  const minLength = 700
  const requiredSections =
    style === 'sare'
      ? ['Situacao', 'Alinhamentos', 'Resultado', 'Expectativa']
      : style === 'mimo'
        ? ['Momento', 'Impacto', 'Melhoria', 'Orientacao']
        : ['Leitura', 'Forcas', 'Plano', 'Expectativa']

  const normalizedText = cleanText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const hasSections = requiredSections.every((section) => normalizedText.includes(section.toLowerCase()))

  if (cleanText.length < minLength || !hasSections) {
    throw new Error('A IA devolveu um feedback curto ou incompleto. Usei a sugestao local para preservar a qualidade do relatorio.')
  }

  return cleanText
}

async function generateWithGemini(prompt: string, style: ChatFeedbackRequest['feedbackStyle']) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY nao configurada. Adicione a chave da Gemini nas variaveis de ambiente da Vercel.')
  }

  const configuredModel = process.env.GEMINI_MODEL?.trim()
  const models = Array.from(
    new Set(
      [
        configuredModel,
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash',
        'gemini-1.5-flash',
      ].filter(Boolean) as string[],
    ),
  )
  const errors: string[] = []

  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: 'Voce escreve devolutivas mensais de gestao, com tom humano, pratico e profissional.',
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1800,
        },
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      const code = data?.error?.status || data?.error?.code || response.status
      const message = data?.error?.message || data?.message || 'Nao foi possivel gerar feedback com Gemini.'
      errors.push(`${model}: HTTP ${response.status} / ${code} - ${sanitizeProviderMessage(message)}`)

      if (response.status === 404 || /not found|model/i.test(message)) {
        continue
      }

      throw new Error(`Gemini ${model} respondeu HTTP ${response.status}: ${sanitizeProviderMessage(message)}`)
    }

    return assertCompleteFeedback(extractGeminiText(data), style)
  }

  throw new Error(`Nenhum modelo Gemini disponivel respondeu para gerar o feedback. Tentativas: ${errors.join(' | ')}`)
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

async function generateExternalFeedback(prompt: string, style: ChatFeedbackRequest['feedbackStyle']) {
  if (process.env.CHAT_AI_PROVIDER === 'github-models') {
    return { feedback: assertCompleteFeedback(await generateWithGitHubModels(prompt), style), source: 'github-models' }
  }

  return { feedback: await generateWithGemini(prompt, style), source: 'gemini' }
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

    try {
      const prompt = buildPrompt(body)
      const result = await generateExternalFeedback(prompt, body.feedbackStyle ?? 'coach')

      if (result.feedback) {
        return NextResponse.json({ feedback: result.feedback, source: result.source })
      }
    } catch (providerError) {
      const publicReason = getPublicProviderError(providerError)
      console.warn('Chat feedback external AI unavailable:', getErrorText(providerError))

      return NextResponse.json({
        feedback: fallbackFeedback,
        source: 'local-fallback',
        warning:
          `A IA externa não gerou um texto válido agora. Motivo: ${publicReason} Usei a sugestão local baseada nos números do Zendesk e nas regras do painel.`,
      })
    }
  } catch (error) {
    return NextResponse.json({ error: getErrorText(error) }, { status: 500 })
  }
}



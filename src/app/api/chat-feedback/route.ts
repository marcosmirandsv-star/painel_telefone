import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ChatFeedbackRequest = {
  serviceModule?: 'chat' | 'phone'
  feedbackStyle?: 'coach' | 'sare' | 'mimo'
  feedbackGoal?: 'recognition' | 'courseCorrection' | 'maintenance' | 'development'
  feedbackTone?: 'human' | 'direct' | 'executive'
  generationMode?: 'generate' | 'improve'
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
    teamPerformance?: number
    teamAnsweredCalls?: number
    teamTotalCalls?: number
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
    'Use formato Coach com seções: Leitura do ciclo, Forças observadas, Plano de desenvolvimento, Expectativa para o próximo ciclo mensal.',
  sare:
    'Use formato SARE com seções: Situação, Alinhamentos Realizados, Resultado Esperado, Expectativa e Plano de Desenvolvimento.',
  mimo:
    'Use formato MIMO com seções: Momento observado, Impacto, Melhoria ou manutenção, Orientação.',
}

const goalInstructions = {
  recognition:
    'Objetivo: reconhecer desempenho positivo e transformar o que funcionou em comportamento consciente para ser repetido.',
  courseCorrection:
    'Objetivo: corrigir rota com firmeza respeitosa, deixando claro qual indicador exige ação e qual comportamento precisa mudar.',
  maintenance:
    'Objetivo: proteger padrão já atingido, evitando acomodação e explicando quais práticas devem permanecer no próximo ciclo.',
  development:
    'Objetivo: desenvolver competência, conectando indicador, comportamento observado e plano prático de evolução.',
}

const toneInstructions = {
  human:
    'Tom: humano, claro, próximo e profissional, como uma liderança que orienta sem soar automática.',
  direct:
    'Tom: direto e assertivo, com frases objetivas, sem dureza desnecessária.',
  executive:
    'Tom: executivo, sintético e estratégico, mantendo orientação prática suficiente para o colaborador agir.',
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

  if (/GEMINI_API_KEY não configurada/i.test(message)) {
    return 'a variável GEMINI_API_KEY não chegou ao deploy ativo.'
  }

  if (/curto|incompleto|truncado|MAX_TOKENS/i.test(message)) {
    return `a Gemini respondeu, mas o texto foi rejeitado pelo controle de qualidade. Detalhe: ${message.slice(0, 260)}`
  }

  if (/Nenhum modelo Gemini/i.test(message)) {
    return message.slice(0, 420)
  }

  return `Gemini respondeu: ${message.slice(0, 320)}`
}

function buildPrompt(body: ChatFeedbackRequest) {
  const metric = body.metric
  const feedbackStyle = body.feedbackStyle ?? 'coach'
  const feedbackGoal = body.feedbackGoal ?? 'development'
  const feedbackTone = body.feedbackTone ?? 'human'
  const generationMode = body.generationMode ?? 'generate'
  const serviceModule = body.serviceModule ?? 'chat'
  const moduleName = serviceModule === 'phone' ? 'telefone' : 'chat'
  const sourceName = serviceModule === 'phone' ? 'lançamentos do painel de telefone' : 'dados do Zendesk'
  const cadenceRule = serviceModule === 'phone'
    ? '- O módulo telefone é alimentado semanalmente, mas a devolutiva final é mensal. Pode orientar acompanhamento semanal quando isso ajudar o fechamento.'
    : '- Não diga para acompanhar semanalmente, porque o módulo do chat é analisado mensalmente.'

  return `
Você é um coach sênior de atendimento ao cliente e editor de relatórios de performance. Sua tarefa principal é melhorar o texto base do sistema, preservando a estrutura, os números e a lógica calculada, mas elevando a qualidade humana, gerencial e prática da devolutiva.

Módulo analisado: ${moduleName}
Fonte dos dados: ${sourceName}
Intenção da IA: ${generationMode === 'improve' ? 'melhorar o texto atual mantendo a estrutura e aprofundando orientação prática' : 'gerar uma devolutiva completa a partir da sugestão local'}
${goalInstructions[feedbackGoal]}
${toneInstructions[feedbackTone]}

Regras obrigatorias:
- Escreva em portugues do Brasil.
${cadenceRule}
- Não comece com parabens generico. Comece com uma leitura profissional do ciclo.
- Use o texto base do sistema como esqueleto obrigatorio; refine, aprofunde e humanize, mas não substitua por um texto curto.
- Preserve todos os numeros relevantes; não invente dados e não mude cálculos.
- Não use Markdown, asteriscos, bullets soltos ou titulos decorativos. Escreva em texto limpo, com nomes de seções seguidos de dois-pontos.
- Mantenha todas as seções do modelo escolhido e escreva pelo menos 2 frases em cada secao.
- O feedback deve ser completo e útil. Se for direto, ainda assim precisa conter leitura do ciclo, orientação prática e expectativa para o próximo fechamento.
- Transforme as observações do gestor em contexto de gestão; não copie literalmente e ignore observações que sejam apenas teste tecnico.
- Traga reconhecimento especifico quando houver pontos fortes, conectando o elogio ao comportamento observado.
- Traga orientação prática em linguagem humana: explique o que o indicador mostra, por que isso importa para cliente/operação e como o analista pode agir.
- Para cada orientação, descreva pelo menos uma ação concreta: exemplo de comportamento, rotina, conferência, abordagem, pedido de avaliação ou combinação com liderança.
- Se o texto base já estiver bom, aprofunde sem alterar a conclusão; se estiver genérico, substitua por recomendações mais específicas.
- Não termine frase pela metade. Entregue um texto completo, pronto para colar no relatório.
- Mantenha entre 180 e 320 palavras. Prefira clareza e completude em vez de texto longo.
- ${styleInstructions[feedbackStyle]}

Periodo: ${body.periodLabel ?? 'Periodo não informado'}
Analista: ${metric?.analystName}
Equipe: ${metric?.teamName ?? 'Equipe não informada'}
Status: ${metric?.status ?? 'Não informado'}
CSAT: ${metric?.csat}% | Meta CSAT: ${metric?.csatGoal}%
Avaliações: ${metric?.reviewPercentage}% | Meta avaliações: ${metric?.reviewGoal ?? 25}%
Envio/sem avaliação: ${metric?.sendingPercentage}%
Atendimentos totais: ${metric?.totalTickets}
Atendimentos inativos: ${metric?.inactiveTickets}
Atendimentos válidos: ${metric?.validTickets}
Avaliacoes recebidas: ${metric?.reviews}
Positivas: ${metric?.positiveReviews}
Negativas: ${metric?.negativeReviews}
Media de atendimentos da operacao: ${body.averageTickets}
Posição no pódio: ${body.podiumPosition && body.podiumPosition > 0 ? `${body.podiumPosition}o lugar` : 'fora do pódio'}

Historico mensal:
${JSON.stringify(body.monthlyHistory ?? [], null, 2)}

Observacoes do gestor:
${body.managerNotes?.trim() || 'Sem observações adicionais.'}

Texto base do sistema que deve ser melhorado e preservado como estrutura:
${body.fallbackText ?? ''}

Saida esperada:
Entregue apenas o feedback final, sem introdução, sem comentários sobre a tarefa e sem Markdown.
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
  const minLength = 260
  const requiredSections =
    style === 'sare'
      ? ['Situacao', 'Alinhamentos', 'Resultado', 'Expectativa']
      : style === 'mimo'
        ? ['Momento', 'Impacto', 'Melhoria', 'Orientacao']
        : ['Leitura', 'Forcas', 'Plano', 'Expectativa']

  const normalizedText = cleanText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const matchedSections = requiredSections.filter((section) => normalizedText.includes(section.toLowerCase())).length
  const hasSections = matchedSections >= 2 || cleanText.length >= 380

  if (cleanText.length < minLength || !hasSections) {
    throw new Error(`A IA devolveu um feedback curto ou incompleto (${cleanText.length} caracteres, ${matchedSections}/${requiredSections.length} seções reconhecidas). Usei a sugestão local para preservar a qualidade do relatório.`)
  }

  return cleanText
}

async function generateWithGemini(prompt: string, style: ChatFeedbackRequest['feedbackStyle']) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não configurada. Adicione a chave da Gemini nas variaveis de ambiente da Vercel.')
  }

  const configuredModel = process.env.GEMINI_MODEL?.trim()
  const models = Array.from(
    new Set(
      [
        configuredModel,
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
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
              text: 'Você escreve devolutivas mensais de gestão, com tom humano, pratico e profissional.',
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
          maxOutputTokens: 4096,
          temperature: 0.35,
        },
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      const code = data?.error?.status || data?.error?.code || response.status
      const message = data?.error?.message || data?.message || 'Não foi possível gerar feedback com Gemini.'
      errors.push(`${model}: HTTP ${response.status} / ${code} - ${sanitizeProviderMessage(message)}`)

      if (response.status === 404 || /not found|model/i.test(message)) {
        continue
      }

      throw new Error(`Gemini ${model} respondeu HTTP ${response.status}: ${sanitizeProviderMessage(message)}`)
    }

    return assertCompleteFeedback(extractGeminiText(data), style)
  }

  throw new Error(`Nenhum modelo Gemini disponível respondeu para gerar o feedback. Tentativas: ${errors.join(' | ')}`)
}

async function generateWithGitHubModels(prompt: string) {
  const token = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN

  if (!token) {
    throw new Error('GITHUB_MODELS_TOKEN não configurado. Adicione na Vercel um token do GitHub com permissão models: read.')
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
          content: 'Você escreve feedbacks profissionais para relatórios mensais de atendimento.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.4,
      max_tokens: 1300,
    }),
  })
  const data = await response.json()

  if (!response.ok) {
    const message = data?.message || data?.error?.message || 'Não foi possível gerar feedback com GitHub Models.'
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
      return NextResponse.json({ error: 'Dados do analista não foram enviados para a IA.' }, { status: 400 })
    }

    const fallbackFeedback = body.fallbackText?.trim()

    if (!fallbackFeedback) {
      return NextResponse.json(
        {
          error:
            'Não ha texto base suficiente para gerar o feedback. Gere uma sugestão local antes de exportar.',
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

      const fallbackSource = body.serviceModule === 'phone'
        ? 'Usei a sugestão local baseada nos lançamentos do telefone e nas regras do painel.'
        : 'Usei a sugestão local baseada nos números do Zendesk e nas regras do painel.'

      return NextResponse.json({
        feedback: fallbackFeedback,
        source: 'local-fallback',
        warning:
          `A IA externa não gerou um texto válido agora. Motivo: ${publicReason} ${fallbackSource}`,
      })
    }
  } catch (error) {
    return NextResponse.json({ error: getErrorText(error) }, { status: 500 })
  }
}



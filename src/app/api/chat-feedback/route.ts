import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ChatFeedbackRequest = {
  serviceModule?: 'chat' | 'phone'
  feedbackStyle?: 'coach' | 'sare' | 'mimo'
  feedbackGoal?: 'recognition' | 'courseCorrection' | 'maintenance' | 'development'
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

function classifyFeedbackCase(body: ChatFeedbackRequest) {
  const metric = body.metric
  if (!metric || !Number(metric.validTickets)) {
    return {
      label: 'Dados insuficientes',
      guidance: 'Apresente apenas os fatos disponíveis e registre o que precisa ser confirmado antes de definir um plano.',
    }
  }

  const csat = Number(metric.csat)
  const csatGoal = Number(metric.csatGoal) || 90
  const reviews = Number(metric.reviewPercentage)
  const reviewGoal = Number(metric.reviewGoal) || 25
  const tickets = Number(metric.totalTickets)
  const averageTickets = Number(body.averageTickets)
  const history = body.monthlyHistory ?? []
  const previous = history.length > 1 ? history.at(-2) : null
  const hasRelevantDrop = Boolean(previous)
    && (csat <= Number(previous?.csat) - 2 || reviews <= Number(previous?.reviewPercentage) - 5)

  if (hasRelevantDrop) {
    return {
      label: 'Mudança recente relevante',
      guidance: 'Priorize a mudança em relação ao mês anterior, preserve os pontos ainda positivos e proponha verificar o que mudou sem inventar causas.',
    }
  }
  if (csat >= csatGoal && reviews >= reviewGoal && (!averageTickets || tickets >= averageTickets)) {
    return {
      label: 'Reconhecimento integral',
      guidance: 'Reconheça o equilíbrio entre qualidade, amostra de avaliações e volume. O combinado deve consolidar uma prática real, sem criar um problema artificial.',
    }
  }
  if (csat >= csatGoal && reviews >= reviewGoal && averageTickets && tickets < averageTickets) {
    return {
      label: 'Qualidade forte com volume abaixo da média',
      guidance: 'Valorize qualidade e avaliações. Trate o volume como tema de investigação conjunta, sem presumir baixa produtividade ou falha de comportamento.',
    }
  }
  if (csat < csatGoal && (!averageTickets || tickets >= averageTickets)) {
    return {
      label: 'Volume consistente com qualidade abaixo da meta',
      guidance: 'Reconheça a entrega de volume e concentre o plano na experiência percebida pelo cliente, usando exemplos reais quando existirem.',
    }
  }
  if (csat >= csatGoal && reviews < reviewGoal) {
    return {
      label: 'Qualidade positiva com baixa amostra de avaliações',
      guidance: 'Reconheça o CSAT, mas explique que a quantidade de respostas ainda limita a segurança da leitura. Foque no encerramento e convite natural para avaliação.',
    }
  }
  return {
    label: body.podiumPosition && body.podiumPosition <= 3 ? 'Resultado em posição de pódio' : 'Resultado misto fora do pódio',
    guidance: 'Escolha somente o indicador que mais limita o resultado e preserve explicitamente o que já está funcionando.',
  }
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
  const generationMode = body.generationMode ?? 'generate'
  const serviceModule = body.serviceModule ?? 'chat'
  const moduleName = serviceModule === 'phone' ? 'telefone' : 'chat'
  const sourceName = serviceModule === 'phone' ? 'lançamentos do painel de telefone' : 'dados do Zendesk'
  const cadenceRule = serviceModule === 'phone'
    ? '- O módulo telefone é alimentado semanalmente, mas a devolutiva final é mensal. Pode orientar acompanhamento semanal quando isso ajudar o fechamento.'
    : '- Não diga para acompanhar semanalmente, porque o módulo do chat é analisado mensalmente.'
  const volumeRule = serviceModule === 'chat'
    ? '- No chat, os tickets entram em uma fila comum e não existe distribuição de chamados pela liderança ou pelo sistema. Cada analista puxa o próximo ticket conforme sua disponibilidade e carga. Nunca mencione "fluxo de distribuição", "distribuição da fila" ou garantia de volume regular. Para investigar volume abaixo da média, proponha observar juntos disponibilidade para puxar novos tickets, tempo dos atendimentos, pausas, ausências e atuação em outras atividades.'
    : '- Quando o volume estiver abaixo da média, informe a diferença em atendimentos e proponha verificar juntos fila, pausas, ausências e atuação em outras atividades antes de responsabilizar a pessoa.'
  const caseProfile = classifyFeedbackCase(body)
  const managerHasContext = Boolean(body.managerNotes?.trim())

  return `
Você é um coach sênior de atendimento ao cliente e editor de relatórios de performance. Sua tarefa é escrever uma devolutiva individual, específica e natural a partir de fatos calculados pelo sistema e do contexto fornecido pelo gestor.

Perspectiva obrigatória: o texto será escrito e entregue pelo próprio gestor ao seu liderado. Escreva na voz dessa liderança, falando diretamente com o analista. O gestor nunca deve aparecer como uma terceira pessoa que o analista precisa procurar.

Módulo analisado: ${moduleName}
Fonte dos dados: ${sourceName}
Intenção da IA: ${generationMode === 'improve' ? 'reescrever o texto atual com liberdade de organização, preservando fatos, números e intenção do gestor' : 'criar uma devolutiva original a partir da base factual, sem copiar sua redação'}
Perfil predominante deste caso: ${caseProfile.label}
Direção específica para este perfil: ${caseProfile.guidance}
${goalInstructions[feedbackGoal]}
Tom obrigatório: humano, claro, próximo e profissional. Escreva como uma boa liderança conversaria com a pessoa em uma reunião individual: com respeito, contexto e direção prática, sem soar automática.

Regras obrigatorias:
- Escreva em portugues do Brasil.
${cadenceRule}
- Fale diretamente com o analista usando "você". Não escreva como um parecer distante sobre "o colaborador".
- Nunca escreva "converse com sua liderança", "alinhe com seu gestor", "procure seu líder" ou orientação equivalente. Quando a verificação depender da gestão, escreva como compromisso direto: "vamos verificar juntos", "vou observar o contexto operacional" ou "combinamos revisar".
- Traduza os indicadores: depois de cada número importante, explique em linguagem simples o que ele significa para a pessoa.
- A taxa de avaliações mede o tamanho da amostra; ela não prova que clientes quiseram elogiar o analista.
- CSAT alto indica satisfação registrada, mas não comprova sozinho empatia, clareza, agilidade ou qualquer comportamento que não esteja nas observações do gestor.
- Diferencie atendimentos totais de atendimentos válidos. A taxa de avaliações é calculada sobre os válidos; não associe essa porcentagem diretamente ao total.
- Não use expressões abstratas como "confiança da gestão", "sustentar elegibilidade" ou "proteger o indicador" sem explicar o comportamento concreto esperado.
- Escolha um foco principal por vez. Reconheça o que está bom, indique o maior impedimento e proponha no máximo duas ações realizáveis.
${volumeRule}
- Só chame uma colocação de pódio quando ela estiver entre o primeiro e o terceiro lugar. Nas demais, diga "posição no ranking".
- Não mencione variação contra período anterior quando não houver um valor anterior real no histórico recebido.
- Não invente a causa de um resultado. Quando a causa não estiver nos dados ou nas observações, registre que gestor e analista vão verificá-la juntos.
- Não comece com parabéns genérico. Comece pelo aspecto que torna este caso diferente dos demais.
- A base do sistema é uma ficha factual, não um modelo de redação. Não copie sua ordem, frases ou cadência. Use-a somente para preservar fatos e limites da análise.
- Se houver observações do gestor, trate-as como principal fonte de personalização e conecte-as ao combinado. Se não houver, não invente comportamento observado nem contexto operacional.
- Preserve os números necessários para sustentar a conclusão, mas não enumere todos os campos recebidos quando eles não contribuírem para o foco principal.
- Não use Markdown, asteriscos, bullets soltos ou titulos decorativos. Escreva em texto limpo, com nomes de seções seguidos de dois-pontos.
- Mantenha os nomes das seções do modelo escolhido, mas varie abertura, extensão, ritmo e construção. Não repita a mesma fórmula em todas as seções.
- O feedback deve ser completo e útil. Se for direto, ainda assim precisa conter leitura do ciclo, orientação prática e expectativa para o próximo fechamento.
- Transforme as observações do gestor em contexto de gestão; não copie literalmente e ignore observações que sejam apenas teste técnico.
- Traga reconhecimento específico quando houver pontos fortes, mas conecte comportamento ao elogio somente quando ele tiver sido informado pelo gestor.
- Traga orientação prática em linguagem humana: explique o que o indicador mostra, por que isso importa para cliente/operação e como o analista pode agir.
- Para cada orientação, descreva pelo menos uma ação concreta: exemplo de comportamento, rotina, conferência, abordagem, pedido de avaliação ou combinado entre gestor e analista.
- Evite frases prontas como "patamar de reconhecimento", "excelência na resolução", "grande confiabilidade" e "manter consistência" quando não houver uma explicação concreta adequada ao caso.
- Em modo de melhoria, reorganize e reescreva de verdade; não faça apenas substituições de palavras.
- Não termine frase pela metade. Entregue um texto completo, pronto para colar no relatório.
- Mantenha entre 150 e 260 palavras. Prefira especificidade e naturalidade em vez de texto longo.
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
Contexto específico fornecido pelo gestor: ${managerHasContext ? 'sim; ele deve orientar a personalização do texto' : 'não; limite-se aos indicadores e sinalize hipóteses como pontos a verificar'}

Base factual do sistema. Preserve os fatos, mas não copie a redação nem a estrutura:
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

function normalizeManagerVoice(text: string) {
  return text
    .replace(/(?:recomendo\s+(?:que\s+você\s+)?conversar|converse)\s+com\s+(?:(?:a\s+)?sua\s+liderança|(?:o\s+)?seu\s+gestor)\s+para\s+(?:validar|entender|confirmar)\s+se\s+/gi, 'vamos verificar juntos se ')
    .replace(/recomendo\s+(?:que\s+você\s+)?conversar\s+com\s+(?:a\s+)?sua\s+liderança\s+para\s+/gi, 'vamos ')
    .replace(/converse\s+com\s+(?:a\s+)?sua\s+liderança\s+para\s+/gi, 'vamos ')
    .replace(/converse\s+com\s+(?:o\s+)?seu\s+gestor\s+para\s+/gi, 'vamos ')
    .replace(/alinhe\s+com\s+(?:o\s+)?seu\s+gestor\s+(?:uma\s+)?revisão\s+(?:de|das?|dos?)\s+/gi, 'vamos revisar juntos ')
    .replace(/confira\s+com\s+(?:o\s+)?seu\s+gestor\s+se\s+/gi, 'vamos conferir juntos se ')
    .replace(/leve\s+(?:ao|para\s+o)\s+gestor\s+/gi, 'traga para nossa conversa ')
    .trim()
}

function normalizeChatQueueLanguage(text: string) {
  return text
    .replace(/fluxo\s+de\s+distribuição\s+de\s+chamados/gi, 'dinâmica da fila e a disponibilidade para puxar novos tickets')
    .replace(/distribuição\s+(?:desigual|diferente)\s+(?:da|de)\s+fila/gi, 'diferenças de disponibilidade para puxar tickets da fila')
    .replace(/distribuição\s+(?:da|de)\s+fila/gi, 'dinâmica da fila')
    .replace(/distribuição\s+de\s+chamados/gi, 'entrada e retirada de chamados da fila')
    .replace(/(?:eu\s+)?vou\s+validar\s+(?:a\s+)?dinâmica\s+da\s+fila/gi, 'vamos observar juntos a dinâmica da fila')
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
              text: 'Você escreve devolutivas mensais individualizadas, com voz humana de liderança. Varie a construção conforme o caso e nunca deduza comportamentos apenas dos indicadores.',
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
          temperature: 0.65,
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

    return assertCompleteFeedback(normalizeManagerVoice(extractGeminiText(data)), style)
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
      temperature: 0.65,
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
    return { feedback: assertCompleteFeedback(normalizeManagerVoice(await generateWithGitHubModels(prompt)), style), source: 'github-models' }
  }

  return { feedback: await generateWithGemini(prompt, style), source: 'gemini' }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatFeedbackRequest

    if (!body.metric?.analystName) {
      return NextResponse.json({ error: 'Dados do analista não foram enviados para a IA.' }, { status: 400 })
    }

    const managerVoiceFallback = normalizeManagerVoice(body.fallbackText?.trim() ?? '')
    const fallbackFeedback = body.serviceModule === 'phone'
      ? managerVoiceFallback
      : normalizeChatQueueLanguage(managerVoiceFallback)

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
        const feedback = body.serviceModule === 'phone'
          ? result.feedback
          : normalizeChatQueueLanguage(result.feedback)
        return NextResponse.json({ feedback, source: result.source })
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



import { createHash } from 'node:crypto'
import {
  ApiError,
  authorizeClickDeskAutomation,
  authorizeClickDeskSessionClient,
  callClickDeskAutomationDb,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import {
  extractTranscriptText,
  isQualitativeTranscriptSufficient,
  normalizeQualitativeAnalysis,
  qualitativeAnalysisVersion,
  QUALITATIVE_ANALYSIS_VERSION,
  shouldReuseQualitativeCache,
  runQualitativeProviderFallback,
} from '@/lib/clickdesk-qualitative'

export const runtime = 'nodejs'
export const maxDuration = 300

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'

type QualitativeRequest = {
  ticket_id?: string
  force?: boolean
}

type PersistedTicket = {
  clickdesk_ticket_id: string
  analyst_id: string | null
  area: string | null
  satisfaction_label: string | null
  occurred_date: string | null
  identity_role?: string | null
}

type AutomationTicketResponse = {
  ticket?: PersistedTicket
}

function validTicketId(value: string) {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

function getErrorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/Bearer\s+[0-9A-Za-z._-]+/gi, 'Bearer ***')
    .replace(/[0-9A-Za-z_-]{40,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchClickDesk(path: string, apiKey: string, accountId: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    const response = await fetch(`${CLICKDESK_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Account-Id': accountId,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    })

    const text = await response.text()
    let payload: unknown = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = text
    }

    if (!response.ok) {
      const source =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {}
      const message =
        typeof source.message === 'string'
          ? source.message
          : typeof source.error === 'string'
            ? source.error
            : `HTTP ${response.status}`
      throw new Error(`${path}: ${message}`)
    }

    return payload
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonResponse(text: string) {
  const clean = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  return JSON.parse(clean) as unknown
}

function extractGeminiText(data: unknown) {
  const response = data as {
    candidates?: {
      content?: {
        parts?: { text?: string }[]
      }
    }[]
  }

  return response.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim() ?? ''
}

function extractGatewayText(data: unknown) {
  const response = data as {
    choices?: {
      message?: {
        content?: string
      }
    }[]
  }

  return response.choices?.[0]?.message?.content?.trim() ?? ''
}

function buildQualitativePrompt(input: {
  transcript: string
  satisfaction: string | null
  area: string | null
  occurredDate: string | null
}) {
  return `
Você é um analista de qualidade de atendimento. Analise somente o conteúdo fornecido e devolva JSON válido.

OBJETIVO
Identificar sinais qualitativos úteis para gestão sem transformar hipótese em fato.

REGRAS OBRIGATÓRIAS
- Não invente causa, sentimento, responsabilidade ou comportamento.
- O CSAT/satisfação registrada não prova sozinho a causa da nota.
- Quando a evidência não for suficiente, use "unclear" e confiança "low".
- Para influência humana, só use improved ou worsened quando o transcript mostrar mudança atribuível à atuação humana.
- Não deduza intenção, personalidade, capacidade, esforço ou estado emocional interno do atendente.
- "Sentimento" significa apenas o tom observável da interação, não diagnóstico psicológico.
- Em controllability, use analyst somente quando houver ação concreta sob controle do analista; company para sistema/processo interno; external para fatores de fora; customer para decisão/condição do cliente; mixed quando houver mais de um fator demonstrável.
- Escolha primary_cause.category pela causa concreta observável, não pelo tema geral da conversa.
- Use customer_expectation SOMENTE quando o transcript mostrar uma diferença explícita entre o que o cliente esperava e o que o atendimento/produto/processo podia entregar. Nesse caso, primary_cause.summary deve escrever obrigatoriamente "O cliente esperava X, mas Y ocorreu/foi possível", deixando X e Y concretos.
- Não use customer_expectation apenas porque o cliente tinha uma dúvida, pediu orientação ou ficou insatisfeito.
- Encerramento automático por inatividade/regra de timeout deve ser process quando a regra operacional for o fator principal.
- Encerramento prematuro pelo atendente ou investigação que não avança deve ser resolution_quality quando a condução humana for o fator principal.
- Falha, comportamento incorreto, sincronização ou limitação do software deve ser system_or_product quando houver evidência no transcript.
- Dependência de definição contábil, fiscal, SEFAZ ou outro agente externo deve ser external quando essa dependência for o fator principal; se o ponto central for a expectativa de que o suporte fornecesse uma definição fora do seu escopo, customer_expectation só é válido se essa expectativa estiver explícita e o summary explicar exatamente qual era.
- Dúvida sobre passo a passo, primeira emissão, CNPJ ou uso do sistema não é customer_expectation por si só; classifique communication, process, resolution_quality ou unclear conforme a evidência.
- coaching_signal.available deve ser true somente quando houver comportamento observável que possa ser trabalhado em feedback gerencial.
- analyst_takeaway é independente de coaching_signal e responde ao que a própria pessoa pode aprender com este atendimento.
- analyst_takeaway.kind = maintain quando houver comportamento observável adequado que valha repetir, mesmo que ele não seja a causa principal da avaliação.
- analyst_takeaway.kind = develop somente quando houver comportamento observável sob controle do analista que possa ser aprimorado.
- analyst_takeaway.kind = context quando o principal aprendizado for reconhecer que o fator relevante estava fora do controle direto do analista.
- analyst_takeaway.kind = none somente quando o transcript realmente não oferecer evidência segura para manter, desenvolver ou contextualizar.
- O summary de analyst_takeaway deve ser específico ao que aparece na conversa; não use uma frase genérica repetida em todos os tickets.
- Em maintain, não apenas descreva o que o atendente fez. Transforme a evidência em uma prática repetível: diga qual comportamento vale manter, em que situação e por quê. Exemplo de forma: "Ao surgir dúvida sobre o caminho no sistema, mantenha a orientação passo a passo, porque ela reduz ambiguidade e deixa claro o próximo movimento."
- Em develop, descreva uma ação concreta que a pessoa pode praticar; evite rótulos abstratos como "melhorar comunicação".
- Em context, explique o fator fora do controle direto e, quando houver evidência, o que ainda cabe ao analista fazer sem assumir culpa pelo problema.
- Uma avaliação positiva ou negativa, sozinha, nunca define o analyst_takeaway.
- evidence_summary deve ter no máximo 3 itens, em paráfrase curta. Não copie dados pessoais nem trechos longos.
- A leitura de CX deve ser útil à gestão mesmo quando NÃO existe falha humana comprovada. Não responda só "inconclusivo" ou "sem evidência para feedback": separe observação, hipótese e oportunidade prática.
- A hipótese da nota negativa deve explicar um possível elo causa → impacto na experiência → nota, sempre rotulado como hipótese quando o cliente não declarou o motivo. Não trate frustração provável como sentimento psicológico comprovado.
- Distinguir: (1) defeito do produto/processo, (2) ação REALMENTE observada do analista, (3) percepção possível do cliente, (4) prática adicional a ser adotada no próximo caso. Não atribua mau humor, má vontade, desinteresse ou falta de empatia sem fala ou conduta inequívoca no transcript.
- No coaching, aponte UM comportamento específico praticável (p. ex. validar se o cliente conseguiu repetir a emissão, resumir passos ou registrar retorno), explicando efeito esperado. Não afirme que faltou na conversa se não há prova da omissão.
- Em suggested_phrase dê uma fala pronta, curta, humana e tecnicamente viável em português, sem prometer solução garantida, sem culpar cliente e sem supor uma ação que não ocorreu.
- Em verification_check ofereça um indicador objetivo para a gestão conferir em novo ticket (não a mudança futura do CSAT, que depende do cliente).
- Em attribution_caution registre o limite causal de maneira específica. Ser coach é orientar boas práticas, não fabricar culpa.
- limitations deve registrar o que não pode ser concluído com segurança.
- Não reproduza e-mail, telefone, CPF, CNPJ, IDs ou outros identificadores.
- Responda SOMENTE com JSON, sem Markdown.

VALORES PERMITIDOS
initial_sentiment/final_sentiment: positive | neutral | negative | mixed | unclear
primary_cause.category: system_or_product | process | wait_time | communication | resolution_quality | customer_expectation | external | other | unclear
primary_cause.confidence: low | medium | high
human_influence.classification: improved | worsened | neutral | unclear
human_influence.confidence: low | medium | high
controllability.classification: analyst | company | customer | external | mixed | unclear
analyst_takeaway.kind: maintain | develop | context | none
analyst_takeaway.confidence: low | medium | high

FORMATO EXATO
{
  "initial_sentiment": "unclear",
  "final_sentiment": "unclear",
  "primary_cause": {
    "category": "unclear",
    "summary": "",
    "confidence": "low"
  },
  "human_influence": {
    "classification": "unclear",
    "summary": "",
    "confidence": "low"
  },
  "controllability": {
    "classification": "unclear",
    "summary": ""
  },
  "coaching_signal": {
    "available": false,
    "summary": ""
  },
  "analyst_takeaway": {
    "kind": "none",
    "summary": "",
    "confidence": "low"
  },
  "evidence_summary": [],
  "limitations": [],
  "cx_coaching": {
    "negative_rating_hypothesis": "Hipótese objetiva sobre por que a experiência pode ter recebido nota negativa, distinguindo motivo declarado de motivo não comprovado.",
    "customer_experience_impact": "Impacto possível da ocorrência na percepção do cliente; só atribua emoção expressa na conversa.",
    "observable_analyst_behavior": "O que o analista efetivamente fez ou disse, sem julgamento de caráter.",
    "practice_to_improve": "Um procedimento de CX prático e específico para atendimento semelhante, sem presumir que tenha faltado neste.",
    "suggested_phrase": "Frase natural que o analista poderia utilizar em atendimento semelhante.",
    "verification_check": "Um item verificável no transcript futuro que a gestão possa conferir.",
    "attribution_caution": "O que impede afirmar que o analista causou a nota, quando não houver prova.",
    "evidence_confidence": "low"
  }
}

CONTEXTO OPERACIONAL
Área: ${input.area ?? 'não identificada'}
Data: ${input.occurredDate ?? 'não identificada'}
Satisfação registrada: ${input.satisfaction ?? 'sem avaliação'}

TRANSCRIPT REDIGIDO
${input.transcript}
`
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function generateWithGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return null

  const configuredModel = process.env.GEMINI_MODEL?.trim()
  const models = Array.from(
    new Set(
      [
        configuredModel,
        'gemini-3.5-flash-lite',
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
      ].filter(Boolean) as string[],
    ),
  )
  const errors: string[] = []

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: 'Analise atendimento de forma conservadora. Evidência insuficiente deve resultar em unclear, nunca em invenção.',
                },
              ],
            },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 1800,
              responseMimeType: 'application/json',
              thinkingConfig: {
                thinkingLevel: 'low',
              },
            },
          }),
        },
      )

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          data?.error?.message ||
          data?.message ||
          `HTTP ${response.status}`
        const cleanMessage = sanitizeProviderMessage(String(message))
        errors.push(`${model} tentativa ${attempt}: ${cleanMessage}`)

        const temporary =
          response.status === 429 ||
          response.status === 503 ||
          /high demand|temporar|overloaded|quota|resource exhausted/i.test(String(message))

        if (temporary && attempt < 2) {
          await wait(attempt === 1 ? 900 : 1800)
          continue
        }

        if (
          temporary ||
          response.status === 404 ||
          /model|not found/i.test(String(message))
        ) {
          break
        }

        throw new Error(
          `Gemini ${model}: ${cleanMessage.slice(0, 260)}`,
        )
      }

      const text = extractGeminiText(data)
      if (!text) {
        errors.push(`${model} tentativa ${attempt}: resposta vazia`)
        if (attempt < 2) {
          await wait(700)
          continue
        }
        break
      }

      try {
        return {
          provider: 'gemini-direct',
          model,
          analysis: normalizeQualitativeAnalysis(parseJsonResponse(text)),
        }
      } catch (error) {
        errors.push(
          `${model} tentativa ${attempt}: JSON inválido - ${getErrorText(error).slice(0, 120)}`,
        )
        if (attempt < 2) {
          await wait(700)
          continue
        }
        break
      }
    }
  }

  throw new Error(
    `Gemini não devolveu uma análise válida. ${errors.join(' | ').slice(0, 700)}`,
  )
}

async function generateWithGemma(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) return null

  const configuredModel = process.env.CLICKDESK_QUALITATIVE_GEMMA_MODEL?.trim()
  const models = Array.from(
    new Set(
      [
        configuredModel,
        'gemma-4-26b-a4b-it',
        'gemma-4-31b-it',
      ].filter(Boolean) as string[],
    ),
  )
  const errors: string[] = []

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text:
                      'Responda somente JSON válido, sem Markdown. Quando a evidência for insuficiente, use unclear e não invente.\n\n' +
                      prompt,
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: 1800,
              temperature: 0.1,
            },
          }),
        },
      )

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        const message =
          data?.error?.message ||
          data?.message ||
          `HTTP ${response.status}`
        const cleanMessage = sanitizeProviderMessage(String(message))
        errors.push(`${model} tentativa ${attempt}: ${cleanMessage}`)

        const temporary =
          response.status === 429 ||
          response.status === 503 ||
          /high demand|temporar|overloaded|quota|resource exhausted/i.test(String(message))

        if (temporary && attempt < 2) {
          await wait(900)
          continue
        }

        if (
          temporary ||
          response.status === 404 ||
          /model|not found/i.test(String(message))
        ) {
          break
        }

        throw new Error(
          `Gemma ${model}: ${cleanMessage.slice(0, 260)}`,
        )
      }

      const text = extractGeminiText(data)
      if (!text) {
        errors.push(`${model} tentativa ${attempt}: resposta vazia`)
        if (attempt < 2) {
          await wait(700)
          continue
        }
        break
      }

      try {
        return {
          provider: 'google-gemma',
          model,
          analysis: normalizeQualitativeAnalysis(parseJsonResponse(text)),
        }
      } catch (error) {
        errors.push(
          `${model} tentativa ${attempt}: JSON inválido - ${getErrorText(error).slice(0, 120)}`,
        )
        if (attempt < 2) {
          await wait(700)
          continue
        }
        break
      }
    }
  }

  throw new Error(
    `Gemma não devolveu uma análise válida. ${errors.join(' | ').slice(0, 700)}`,
  )
}

async function generateWithVercelGateway(prompt: string) {
  const authToken =
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim()

  if (!authToken) return null

  const configuredModel = process.env.CLICKDESK_QUALITATIVE_MODEL?.trim()
  const models = Array.from(
    new Set(
      [
        configuredModel,
        'google/gemini-3.6-flash',
      ].filter(Boolean) as string[],
    ),
  )
  const errors: string[] = []

  for (const model of models) {
    const response = await fetch(
      'https://ai-gateway.vercel.sh/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content:
                'Analise atendimento de forma conservadora. Evidência insuficiente deve resultar em unclear, nunca em invenção. Responda somente JSON válido.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.15,
          max_tokens: 1800,
          stream: false,
        }),
      },
    )

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        data?.error?.message ||
        data?.message ||
        `HTTP ${response.status}`
      errors.push(`${model}: ${sanitizeProviderMessage(String(message))}`)
      if (
        response.status === 404 ||
        /model|not found|unsupported/i.test(String(message))
      ) {
        continue
      }
      throw new Error(
        `Vercel AI Gateway ${model}: ${sanitizeProviderMessage(String(message)).slice(0, 260)}`,
      )
    }

    const text = extractGatewayText(data)
    if (!text) {
      errors.push(`${model}: resposta vazia`)
      continue
    }

    try {
      return {
        provider: 'vercel-ai-gateway',
        model,
        analysis: normalizeQualitativeAnalysis(parseJsonResponse(text)),
      }
    } catch (error) {
      errors.push(`${model}: JSON inválido - ${getErrorText(error).slice(0, 120)}`)
    }
  }

  throw new Error(
    `Vercel AI Gateway não devolveu uma análise válida. ${errors.join(' | ').slice(0, 500)}`,
  )
}

async function generateWithGitHubModels(prompt: string) {
  const token =
    process.env.GITHUB_MODELS_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim()

  if (!token) return null

  const model =
    process.env.CLICKDESK_QUALITATIVE_GITHUB_MODEL?.trim() ||
    process.env.GITHUB_MODELS_MODEL?.trim() ||
    'openai/gpt-4.1'

  const response = await fetch(
    'https://models.github.ai/inference/chat/completions',
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              'Analise atendimento de forma conservadora. Evidência insuficiente deve resultar em unclear, nunca em invenção. Responda somente JSON válido.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.15,
        max_tokens: 1800,
      }),
    },
  )

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      `HTTP ${response.status}`
    throw new Error(
      `GitHub Models ${model}: ${sanitizeProviderMessage(String(message)).slice(0, 260)}`,
    )
  }

  const text = extractGatewayText(data)
  if (!text) {
    throw new Error(`GitHub Models ${model}: resposta vazia`)
  }

  try {
    return {
      provider: 'github-models',
      model,
      analysis: normalizeQualitativeAnalysis(parseJsonResponse(text)),
    }
  } catch (error) {
    throw new Error(
      `GitHub Models ${model}: JSON inválido - ${getErrorText(error).slice(0, 120)}`,
    )
  }
}

async function generateQualitativeAnalysis(prompt: string) {
  const outcome = await runQualitativeProviderFallback([
    { name: 'gemini', run: () => generateWithGemini(prompt) },
    { name: 'gemma', run: () => generateWithGemma(prompt) },
    { name: 'github-models', run: () => generateWithGitHubModels(prompt) },
    { name: 'vercel-gateway', run: () => generateWithVercelGateway(prompt) },
  ])

  if (outcome.result) return outcome.result

  const reason = outcome.errors.length
    ? outcome.errors.join(' | ').slice(0, 1200)
    : 'nenhum provedor de IA está disponível no ambiente'

  console.warn(
    'IA qualitativa temporariamente indisponível:',
    sanitizeProviderMessage(reason),
  )

  throw new ApiError(
    503,
    'A IA qualitativa está temporariamente indisponível. O ticket não foi alterado e pode ser analisado novamente.',
  )
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'IA qualitativa disponível somente na homologação.')
    }

    const automationRequest =
      request.headers.get('x-central-automation') === 'clickdesk-sync'
    const automationAccess = automationRequest
      ? await authorizeClickDeskAutomation(request)
      : null
    const sessionAccess = automationRequest
      ? null
      : await authorizeClickDeskSessionClient(request)

    const body = (await request.json()) as QualitativeRequest
    const ticketId = body.ticket_id?.trim() ?? ''
    if (!validTicketId(ticketId)) {
      throw new ApiError(400, 'ticket_id inválido.')
    }

    if (body.force && !automationRequest && !sessionAccess?.isManagement) {
      throw new ApiError(403, 'A reanálise forçada é restrita à gestão.')
    }

    let persistedData: PersistedTicket

    if (automationRequest) {
      const payload = (await callClickDeskAutomationDb(
        automationAccess?.token ?? '',
        {
          action: 'ticket',
          ticket_id: ticketId,
        },
      )) as AutomationTicketResponse

      if (!payload.ticket) {
        throw new ApiError(404, 'Atendimento não encontrado na base persistida do Chat.')
      }
      persistedData = payload.ticket
    } else {
      if (!sessionAccess) {
        throw new ApiError(401, 'Sessão inválida.')
      }

      // A análise individual deve consultar exatamente o ledger do painel,
      // sob RLS da sessão (sem varrer milhares de mensagens nem usar service key).
      const { data: final, error: finalError } = await sessionAccess.admin
        .from('clickdesk_final_ticket_ledger')
        .select('ticket_id,analyst_id,team_id,area,satisfaction_label,occurred_date')
        .eq('ticket_id', ticketId)
        .maybeSingle()
      if (finalError) {
        throw new ApiError(503, 'Ledger do ticket indisponível para análise qualitativa.')
      }
      if (!final || (!sessionAccess.isManagement && final.analyst_id !== sessionAccess.chatAnalystId)) {
        throw new ApiError(404, 'Ticket sem autoria final comprovada para este acesso.')
      }
      const { data: pending, error: pendingError } = await sessionAccess.admin
        .from('clickdesk_final_ticket_pending')
        .select('ticket_id')
        .eq('ticket_id', ticketId)
        .maybeSingle()
      if (pendingError) {
        throw new ApiError(503, 'Não foi possível verificar pendências do ticket.')
      }
      if (pending) {
        throw new ApiError(422, 'Ticket em conferência de autoria. A análise não será atribuída por suposição.')
      }
      persistedData = {
        clickdesk_ticket_id: ticketId, analyst_id: final.analyst_id,
        area: final.area, satisfaction_label: final.satisfaction_label,
        occurred_date: final.occurred_date, identity_role: 'analyst',
      }


      if (!body.force) {
        const cached = await sessionAccess.admin
          .from('clickdesk_qualitative_analyses')
          .select(
            'clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,transcript_characters,validation_status,validated_at,updated_at',
          )
          .eq('clickdesk_ticket_id', ticketId)
          .maybeSingle()

        if (
          !cached.error &&
          cached.data &&
          cached.data.analyst_id === persistedData.analyst_id &&
          cached.data.occurred_date === persistedData.occurred_date &&
          cached.data.satisfaction_label === persistedData.satisfaction_label &&
          shouldReuseQualitativeCache(
            cached.data.validation_status,
            qualitativeAnalysisVersion(cached.data.analysis),
          )
        ) {
          return json({
            source: 'clickdesk_qualitative_cache',
            cached: true,
            ticket_id: cached.data.clickdesk_ticket_id,
            analyst_id: cached.data.analyst_id,
            occurred_date: cached.data.occurred_date,
            area: cached.data.area,
            satisfaction_label: cached.data.satisfaction_label,
            transcript_characters_analyzed: cached.data.transcript_characters,
            model: cached.data.model,
            analyzed_at: cached.data.updated_at,
            validation_status: cached.data.validation_status,
            validated_at: cached.data.validated_at,
            analysis: normalizeQualitativeAnalysis(cached.data.analysis),
          })
        }
      }
    }

    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const accountId = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    if (!apiKey || !accountId) {
      throw new ApiError(503, 'Credenciais ClickDesk não configuradas.')
    }

    let transcriptPayload: unknown
    try {
      transcriptPayload = await fetchClickDesk(
        `/tickets/${encodeURIComponent(ticketId)}/transcript`,
        apiKey,
        accountId,
      )
    } catch (error) {
      throw new ApiError(
        503,
        `Não foi possível carregar o transcript do ClickDesk: ${sanitizeProviderMessage(getErrorText(error)).slice(0, 260)}`,
      )
    }

    const transcript = extractTranscriptText(transcriptPayload)
    if (!isQualitativeTranscriptSufficient(transcript)) {
      throw new ApiError(
        422,
        'O transcript não trouxe texto suficiente para uma análise qualitativa segura.',
      )
    }

    const transcriptHash = createHash('sha256').update(transcript).digest('hex')
    const result = await generateQualitativeAnalysis(
      buildQualitativePrompt({
        transcript,
        satisfaction: persistedData.satisfaction_label,
        area: persistedData.area,
        occurredDate: persistedData.occurred_date,
      }),
    )

    if (!persistedData.analyst_id) {
      throw new ApiError(422, 'Atendimento sem vínculo de analista para salvar a análise.')
    }

    const storedAnalysis = {
      ...result.analysis,
      _analysis_version: QUALITATIVE_ANALYSIS_VERSION,
    }

    if (automationRequest) {
      await callClickDeskAutomationDb(automationAccess?.token ?? '', {
        action: 'save',
        ticket_id: ticketId,
        analysis: storedAnalysis,
        model: result.model,
        transcript_hash: transcriptHash,
        transcript_characters: transcript.length,
      })
    } else {
      if (!sessionAccess) {
        throw new ApiError(401, 'Sessão inválida.')
      }

      const stored = await sessionAccess.admin
        .from('clickdesk_qualitative_analyses')
        .upsert(
          {
            clickdesk_ticket_id: ticketId,
            analyst_id: persistedData.analyst_id,
            occurred_date: persistedData.occurred_date,
            area: persistedData.area,
            satisfaction_label: persistedData.satisfaction_label,
            analysis: storedAnalysis,
            model: result.model,
            transcript_hash: transcriptHash,
            transcript_characters: transcript.length,
            created_by: sessionAccess.userId,
            validation_status: 'pending',
            validated_by: null,
            validated_at: null,
            validation_notes: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clickdesk_ticket_id' },
        )

      if (stored.error) {
        throw new ApiError(
          503,
          `A análise foi gerada, mas não pôde ser salva para validação: ${sanitizeProviderMessage(stored.error.message).slice(0, 220)}`,
        )
      }
    }

    const cached = true

    return json({
      source: `clickdesk_transcript_${result.provider}`,
      cached,
      ticket_id: ticketId,
      analyst_id: persistedData.analyst_id,
      occurred_date: persistedData.occurred_date,
      area: persistedData.area,
      satisfaction_label: persistedData.satisfaction_label,
      transcript_characters_analyzed: transcript.length,
      model: result.model,
      analyzed_at: new Date().toISOString(),
      validation_status: 'pending',
      validated_at: null,
      analysis: result.analysis,
    })
  })
}


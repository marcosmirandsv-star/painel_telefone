import { createHash } from 'node:crypto'
import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import {
  extractTranscriptText,
  isQualitativeTranscriptSufficient,
  normalizeQualitativeAnalysis,
  runQualitativeProviderFallback,
} from '@/lib/clickdesk-qualitative'

export const runtime = 'nodejs'

const CLICKDESK_BASE_URL = 'https://api.desk.click.app/api/v1'

type QualitativeRequest = {
  ticket_id?: string
  force?: boolean
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
  "limitations": []
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

    const access = await authorizeClickDeskSessionClient(request)
    const body = (await request.json()) as QualitativeRequest
    const ticketId = body.ticket_id?.trim() ?? ''
    if (!validTicketId(ticketId)) {
      throw new ApiError(400, 'ticket_id inválido.')
    }

    if (body.force && !access.isManagement) {
      throw new ApiError(403, 'A reanálise forçada é restrita à gestão.')
    }

    if (!body.force) {
      const cached = await access.admin
        .from('clickdesk_qualitative_analyses')
        .select(
          'clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,transcript_characters,validation_status,validated_at,updated_at',
        )
        .eq('clickdesk_ticket_id', ticketId)
        .maybeSingle()

      if (!cached.error && cached.data) {
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

    const persisted = await access.admin
      .from('clickdesk_chat_attendances')
      .select(
        'clickdesk_ticket_id,analyst_id,area,satisfaction_label,occurred_date,identity_role',
      )
      .eq('clickdesk_ticket_id', ticketId)
      .eq('identity_role', 'analyst')
      .maybeSingle()

    if (persisted.error) {
      throw new ApiError(503, 'Não foi possível validar o atendimento persistido.')
    }
    if (!persisted.data) {
      throw new ApiError(404, 'Atendimento não encontrado na base persistida do Chat.')
    }

    if (
      !access.isManagement &&
      persisted.data.analyst_id !== access.chatAnalystId
    ) {
      throw new ApiError(404, 'Atendimento não encontrado na sua base individual.')
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
        satisfaction: persisted.data.satisfaction_label,
        area: persisted.data.area,
        occurredDate: persisted.data.occurred_date,
      }),
    )

    if (!persisted.data.analyst_id) {
      throw new ApiError(422, 'Atendimento sem vínculo de analista para salvar a análise.')
    }

    const stored = await access.admin
      .from('clickdesk_qualitative_analyses')
      .upsert(
        {
          clickdesk_ticket_id: ticketId,
          analyst_id: persisted.data.analyst_id,
          occurred_date: persisted.data.occurred_date,
          area: persisted.data.area,
          satisfaction_label: persisted.data.satisfaction_label,
          analysis: result.analysis,
          model: result.model,
          transcript_hash: transcriptHash,
          transcript_characters: transcript.length,
          created_by: access.userId,
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

    const cached = true

    return json({
      source: `clickdesk_transcript_${result.provider}`,
      cached,
      ticket_id: ticketId,
      analyst_id: persisted.data.analyst_id,
      occurred_date: persisted.data.occurred_date,
      area: persisted.data.area,
      satisfaction_label: persisted.data.satisfaction_label,
      transcript_characters_analyzed: transcript.length,
      model: result.model,
      analyzed_at: new Date().toISOString(),
      validation_status: 'pending',
      validated_at: null,
      analysis: result.analysis,
    })
  })
}

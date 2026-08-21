import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

type ManagementAnalysisRequest = {
  periodLabel?: string
  riskLevel?: string
  goalProbability?: number
  team?: {
    csat?: number
    csatGoal?: number
    csatDelta?: number
    performance?: number
    performanceGoal?: number
    performanceDelta?: number
    reviewCoverage?: number
    reviewGoal?: number
    answeredCalls?: number
    totalCalls?: number
    eligibleCount?: number
    totalAnalysts?: number
  }
  analysts?: {
    name: string
    csat: number
    csatGoal: number
    reviewPercentage: number
    reviewGoal: number
    tickets: number
    teamAverageTickets: number
    reasons: string[]
  }[]
  localDiagnosis?: string
  localAction?: string
}

function normalizeRole(role: unknown) {
  if (typeof role !== 'string') return null
  const normalized = role.toLowerCase()
  if (normalized === 'master') return 'master'
  if (normalized === 'coordenadora' || normalized === 'coordinator') return 'coordinator'
  return null
}

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/[0-9A-Za-z_-]{32,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractGeminiResult(data: unknown) {
  const response = data as {
    candidates?: {
      content?: { parts?: { text?: string }[] }
      finishReason?: string
    }[]
  }

  const candidate = response.candidates?.[0]
  return {
    text: candidate?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '',
    finishReason: candidate?.finishReason ?? 'não informado',
  }
}

function isCompleteManagementAnalysis(analysis: string) {
  const requiredSections = [
    'Diagnóstico do período:',
    'Prioridades da gestão:',
    'Plano de ação:',
    'Como acompanhar:',
  ]
  const sectionCount = requiredSections.filter((section) => analysis.includes(section)).length
  return analysis.length >= 280 && sectionCount >= 3
}

function buildPrompt(body: ManagementAnalysisRequest) {
  return `
Você é uma consultora sênior de gestão de operações de atendimento ao cliente. Analise os indicadores já calculados pelo sistema de performance do telefone e transforme-os em orientação gerencial clara e executável.

Regras obrigatórias:
- Escreva em português do Brasil, com acentuação correta e linguagem humana.
- Não recalcule nem altere os números recebidos.
- Não invente causas. Quando uma causa não estiver nos dados, diga o que o gestor deve verificar.
- Diferencie risco da operação, risco de qualidade e risco de elegibilidade ao pódio.
- Cite nominalmente os analistas em atenção e o critério de cada um.
- Priorize no máximo três movimentos, em ordem de impacto e urgência.
- Para cada movimento, informe: quem/indicador, o que fazer, quando conferir e qual resultado observar.
- Recomende MIMO para ajuste ou manutenção imediata. Só recomende SARE quando houver necessidade de plano formal de desenvolvimento.
- Não exponha dados de clientes e não faça julgamento pessoal dos analistas.
- Não use Markdown, asteriscos ou tabelas.
- Entregue de 160 a 260 palavras, com exatamente estas seções: Diagnóstico do período:, Prioridades da gestão:, Plano de ação:, Como acompanhar:.

Período: ${body.periodLabel ?? 'não informado'}
Risco calculado pelas regras: ${body.riskLevel ?? 'não informado'}
Chance geral de fechamento: ${body.goalProbability ?? 0}%
Indicadores da equipe: ${JSON.stringify(body.team ?? {})}
Analistas em atenção: ${JSON.stringify(body.analysts ?? [])}
Diagnóstico local do sistema: ${body.localDiagnosis ?? 'não informado'}
Ação local sugerida: ${body.localAction ?? 'não informada'}

Entregue somente a análise final.
`
}

async function generateWithGemini(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('A chave da Gemini não está configurada no deploy.')

  const configuredModel = process.env.GEMINI_MODEL?.trim()
  const models = Array.from(new Set([
    configuredModel,
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
  ].filter(Boolean) as string[]))
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
          parts: [{ text: 'Você produz análises gerenciais objetivas, prudentes e acionáveis.' }],
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 3000, temperature: 0.25 },
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      const message = data?.error?.message || 'Falha ao consultar a Gemini.'
      errors.push(`${model}: ${response.status} - ${sanitizeProviderMessage(message)}`)
      if (response.status === 404 || /model|not found/i.test(message)) continue
      throw new Error(message)
    }

    const result = extractGeminiResult(data)
    const analysis = result.text.replace(/\*\*/g, '').trim()
    if (!isCompleteManagementAnalysis(analysis)) {
      errors.push(`${model}: resposta incompleta (${analysis.length} caracteres; término ${result.finishReason})`)
      continue
    }
    return analysis
  }

  throw new Error(`Nenhum modelo disponível gerou uma análise completa. ${errors.join(' | ')}`)
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Validação de acesso não configurada.' }, { status: 500 })
    }

    const token = request.headers.get('authorization')?.replace('Bearer ', '').trim()
    if (!token) return NextResponse.json({ error: 'Sessão não encontrada.' }, { status: 401 })

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) return NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 })

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profileError || !normalizeRole(profile?.role)) {
      return NextResponse.json({ error: 'Recurso disponível apenas para a gestão.' }, { status: 403 })
    }

    const body = (await request.json()) as ManagementAnalysisRequest
    const analysis = await generateWithGemini(buildPrompt(body))
    return NextResponse.json({ analysis, source: 'gemini' })
  } catch (error) {
    const message = error instanceof Error ? sanitizeProviderMessage(error.message) : 'Erro inesperado.'
    console.warn('Management analysis unavailable:', message)
    return NextResponse.json(
      { error: `A análise com IA não está disponível agora. A leitura calculada pelo sistema continua válida. Motivo: ${message}` },
      { status: 503 },
    )
  }
}

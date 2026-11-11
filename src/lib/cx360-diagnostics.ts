export const CX_ANALYSIS_VERSION = 'cx-production-20261110-v3'
export const factors = ['produto', 'operacao', 'externo', 'conducao', 'misto', 'inconclusivo'] as const
export type Factor = typeof factors[number]
export const factorLabels: Record<Factor, string> = { produto: 'Produto / sistema', operacao: 'Processo / operação', externo: 'Dependência externa', conducao: 'Condução humana', misto: 'Fatores combinados', inconclusivo: 'Inconclusivo' }
export type Evidence = { id: string; at: string; role: string; author?: string; text: string; attachments: number }
export type Diagnosis = {
  factor: Factor; confidence: 'baixa' | 'media' | 'alta'; observation: string; hypothesis: string;
  impact: string; behavior: string; practice: string; suggested_phrase: string; verification: string;
  limitations: string[]; evidence_ids: string[]; human_gap?: string | null; human_gap_evidence_ids?: string[]
  human_review?: {version:string;confirmed:boolean;basis:string;reason:string;evidence_ids:string[]}
}
export type DiagnosticRow = {
  id: string; ticket_id: string; number: string; subject: string; team_id: string; source_team: string;
  rated_at: string; label: string; owner_name: string; eligible: boolean; excluded_reason: string | null;
  status: 'pending' | 'processing' | 'analyzed' | 'inconclusive' | 'failed'; analysis: Diagnosis | null;
  evidence: Evidence[]; analysis_hash: string | null; error_code: string | null; updated_at: string;
  review_decision?: 'confirmed' | 'rejected' | null;
}
export const approvedOwners = ['João Pedro Vianey','João Vitor Almeida','Thiago Reis','Carlos Henrique','Paulo Victor','Vanessa Silva','Diego Machado','Mario Junior','Igor Siqueira','Polliana Santana','Karolyne Moreira','Maycon Oliveira','Miguel Augusto','João Pedro Santana','Christian Matozinho']
export const normalizeName = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export function canonicalOwner(value: string) { return normalizeName(value) === 'carlos lemos' ? 'Carlos Henrique' : value.trim() }
export function eligibleOwner(value: string) { return approvedOwners.some(name => normalizeName(name) === normalizeName(canonicalOwner(value))) }
export function brtDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function d1(now = new Date()) { return new Date(Date.parse(`${brtDay(now)}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) }
export function scopeDates(start: unknown, end: unknown, now = new Date()) {
  const valid = (v: unknown): v is string => typeof v === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
  if (!valid(start) || !valid(end) || start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 31) throw new Error('Selecione um período de até 32 dias.')
  const cutoff = d1(now), effectiveEnd = end > cutoff ? cutoff : end
  if (start > effectiveEnd) throw new Error('Resultados de hoje ficam disponíveis no dia seguinte. Selecione até D-1.')
  return { start, end: effectiveEnd, cutoff }
}
export function ratingTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Avaliação sem data verificável.')
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value)
  if (match) {
    const [, day, month, year, hour, minute] = match
    const iso = `${year}-${month}-${day}T${hour}:${minute}:00-03:00`
    if (Number(hour) > 23 || Number(minute) > 59 || new Date(`${year}-${month}-${day}`).toISOString().slice(0, 10) !== `${year}-${month}-${day}`) throw new Error('Data de avaliação inválida.')
    return new Date(iso).toISOString()
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !/Z$|[+-]\d\d:\d\d$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Data de avaliação inválida.')
  return new Date(value).toISOString()
}
export function redactText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const plain = value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/\s+/g,' ').trim()
  if (/senha|password|token|api.?key|login\s*[:=]|usu[aá]rio\s*[:=]|teamviewer|anydesk/i.test(plain)) return '[Dados de acesso omitidos]'
  return plain.replace(/https?:\/\/\S+/gi, '[link omitido]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email omitido]').replace(/(?:\+?\d[\d\s().\/-]{6,}\d)/g,'[identificador omitido]').slice(0, 4000)
}
export function prepareMessages(raw: unknown, ratedAt: string): { messages: Evidence[]; limitations: string[]; human: boolean } {
  const root = raw as { messages?: unknown[]; data?: unknown[]; last_page?: number }
  const list = Array.isArray(root?.messages) ? root.messages : Array.isArray(root?.data) ? root.data : null
  if (!list) throw new Error('Histórico de mensagens indisponível.')
  if (root.last_page && root.last_page > 1) throw new Error('Histórico paginado exige leitura integral.')
  const cutoff = Date.parse(ratedAt)
  let sensitive = false
  const messages: Evidence[] = []
  const sorted = [...list].sort((a, b) => Date.parse(String((a as Record<string, unknown>).created_at)) - Date.parse(String((b as Record<string, unknown>).created_at)))
  for (const item of sorted) {
    const m = item as Record<string, unknown>
    if (typeof m.created_at !== 'string' || !Number.isFinite(Date.parse(m.created_at))) throw new Error('Mensagem sem horário verificável.')
    if (Date.parse(m.created_at) >= cutoff) continue
    const role = m.author_type === 'agent' ? 'Analista' : m.author_type === 'contact' ? 'Cliente' : 'Sistema / IA'
    let text = redactText(m.body)
    const credentialRequest = /dados de acesso|senha|teamviewer|anydesk|login|certificado digital/i.test(String(m.body ?? ''))
    if (role === 'Cliente' && sensitive) text = '[Resposta a pedido de acesso omitida]'
    if (role === 'Analista' || role === 'Sistema / IA') sensitive = credentialRequest
    if (credentialRequest && role === 'Cliente') sensitive = true
    if (!/^\d+$/.test(String(m.id))) throw new Error('Mensagem sem identificador verificável.')
    messages.push({ id: String(m.id), at: m.created_at, role: m.visibility === 'internal' ? `${role} · nota interna` : role,
      ...(role === 'Analista' ? { author: typeof m.author === 'string' ? redactText(m.author) : 'Autor humano não identificado' } : {}),
      text, attachments: Array.isArray(m.attachments) ? m.attachments.length : 0 })
  }
  if (messages.length > 1200 || JSON.stringify(messages).length > 180000) throw new Error('Histórico extenso: requer leitura específica, sem truncamento silencioso.')
  return { messages, human: messages.some(m => m.role === 'Analista'), limitations: ['Data da avaliação fornecida com precisão de minuto: mensagens do mesmo minuto e posteriores foram desconsideradas por cautela.', 'Anexos e atendimentos paralelos não foram inspecionados.', 'A nota não comprova a causa da insatisfação nem a responsabilidade individual.'] }
}
export function validateDiagnosis(raw: unknown, messages: Evidence[], human: boolean, evaluatedOwner?: string): Diagnosis {
  if (!raw || typeof raw !== 'object') throw new Error('Análise inválida.')
  const r = raw as Record<string, unknown>
  if (!factors.includes(r.factor as Factor) || !['baixa','media','alta'].includes(String(r.confidence))) throw new Error('Classificação inválida.')
  const result = { factor: r.factor, confidence: r.confidence } as Diagnosis
  for (const key of ['observation','hypothesis','impact','behavior','practice','suggested_phrase','verification'] as const) {
    if (typeof r[key] !== 'string' || (r[key] as string).trim().length < 5 || (r[key] as string).length > 1800) throw new Error('Análise incompleta.')
    result[key] = redactText(r[key])
  }
  if (!Array.isArray(r.evidence_ids) || r.evidence_ids.length < 1 || r.evidence_ids.length > 4 || r.evidence_ids.some(id => typeof id !== 'string' || !messages.some(m => m.id === id))) throw new Error('Análise sem referências verificáveis no histórico anterior à nota.')
  result.evidence_ids = [...new Set(r.evidence_ids as string[])]
  if (!Array.isArray(r.limitations) || r.limitations.some(v => typeof v !== 'string')) throw new Error('Limitações ausentes.')
  result.limitations = (r.limitations as string[]).slice(0,6).map(redactText)
  result.human_gap = typeof r.human_gap === 'string' && r.human_gap.trim().length >= 10 ? redactText(r.human_gap) : null
  const gapIds = Array.isArray(r.human_gap_evidence_ids) ? r.human_gap_evidence_ids : []
  const supportedGap = human && result.human_gap && gapIds.length > 0 && gapIds.length <= 4 && gapIds.every(id =>
    typeof id === 'string' && result.evidence_ids.includes(id) && messages.some(m => m.id === id && m.role === 'Analista' &&
      (!evaluatedOwner || (m.author && normalizeName(canonicalOwner(m.author)) === normalizeName(canonicalOwner(evaluatedOwner))))))
  result.human_gap_evidence_ids = supportedGap ? [...new Set(gapIds as string[])] : []
  if (!supportedGap) result.human_gap = null
  if ((result.factor === 'conducao' || result.factor === 'misto') && !supportedGap) {
    result.factor = 'inconclusivo'; result.confidence = 'baixa'
    result.limitations.push('A leitura não demonstrou uma falha humana observada com mensagens atribuíveis à pessoa avaliada. Oportunidade de melhoria não comprova causa humana da nota.')
  }
  if (!human) {
    if(result.factor === 'conducao' || result.factor === 'misto'){result.factor='inconclusivo';result.confidence='baixa'}
    result.behavior = 'Não há resposta humana pública atribuível à pessoa avaliada antes da nota neste histórico. Não atribuir a nota ao responsável atual nem a autores não identificados.'
    result.limitations.push('Nenhuma resposta humana pública da pessoa avaliada foi identificada antes da nota.')
  }
  return result
}

export type PilotMessage = {
  id: string
  timestamp: string
  authorName: string
  authorType: string
  visibility: 'public' | 'internal' | 'unknown'
  text: string
}

export type PreparedEvidence = {
  ready: boolean
  shouldCallGemini: boolean
  gaps: string[]
  messages: PilotMessage[]
  analystName: string
  cutoff: string | null
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''
const identity = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')
const timestamp = (value: unknown): number => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  return Date.parse(value)
}

/** A caller may call Gemini only when ready is true. No network or data writes occur here. */
export function preparePilotEvidence(input: {
  messages: unknown
  ratedAt: string
  analystName: string
  historyComplete: boolean
  verifiedAttachmentIds?: readonly string[]
}): PreparedEvidence {
  const gaps: string[] = []
  const addGap = (gap: string) => { if (!gaps.includes(gap)) gaps.push(gap) }
  if (!input.historyComplete) addGap('history_incomplete')
  if (!identity(input.analystName)) addGap('analyst_identity_missing')
  const rated = timestamp(input.ratedAt)
  if (!Number.isFinite(rated)) addGap('rating_timestamp_invalid')
  // Ratings have minute precision. Even a message earlier in the same minute is excluded.
  const cutoff = Number.isFinite(rated) ? Math.floor(rated / 60000) * 60000 : NaN
  if (!Array.isArray(input.messages)) addGap('messages_missing')
  const messages: PilotMessage[] = []
  const ids = new Set<string>()
  const attachmentIds = new Set(input.verifiedAttachmentIds ?? [])
  for (const value of Array.isArray(input.messages) ? input.messages : []) {
    const raw = record(value)
    const id = typeof raw.id === 'number' && Number.isSafeInteger(raw.id) ? String(raw.id) : string(raw.id).trim()
    if (!id) addGap('message_id_missing')
    else if (ids.has(id)) addGap('duplicate_message_id')
    ids.add(id)
    const rawTime = raw.created_at ?? raw.timestamp
    const at = timestamp(rawTime)
    if (!Number.isFinite(at)) { addGap('message_timestamp_invalid'); continue }
    if (!Number.isFinite(cutoff) || at >= cutoff) continue
    const author = record(raw.author)
    const authorName = typeof raw.author === 'string' ? raw.author : string(author.name) || string(raw.author_name)
    const authorType = identity(string(raw.author_type) || string(author.type))
    const visibilityValue = identity(string(raw.visibility))
    const publicFalse = raw.public === false || raw.is_public === false
    const publicTrue = raw.public === true || raw.is_public === true
    const internal = publicFalse || ['internal', 'private'].includes(visibilityValue)
    if (internal && publicTrue) addGap('message_visibility_conflict')
    const visibility = internal ? 'internal' : visibilityValue === 'public' || publicTrue ? 'public' : 'unknown'
    if (visibility === 'unknown') addGap('message_visibility_missing')
    if (!authorName || !authorType) addGap('message_author_missing')
    const attachments = raw.attachments ?? raw.files
    if (attachments !== undefined && attachments !== null) {
      if (!Array.isArray(attachments)) addGap('attachment_metadata_invalid')
      else for (const item of attachments) {
        const attachment = record(item)
        const attachmentId = typeof attachment.id === 'number' ? String(attachment.id) : string(attachment.id)
        if (!attachmentId || !attachmentIds.has(attachmentId)) addGap('attachment_uninspected')
      }
    }
    const body = string(raw.body) || string(raw.content) || string(raw.text)
    if (body.length) messages.push({id, timestamp: new Date(at).toISOString(), authorName, authorType, visibility, text: body})
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
  if (!messages.length) addGap('messages_before_rating_missing')
  if (!messages.some(m => m.visibility === 'public' && ['agent', 'human'].includes(m.authorType) && identity(m.authorName) === identity(input.analystName))) {
    addGap('own_public_message_before_rating_missing')
  }
  const ready = gaps.length === 0
  return {ready, shouldCallGemini: ready, gaps, messages, analystName: input.analystName, cutoff: Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null}
}

export type PilotCause = 'human' | 'system' | 'other_external' | 'mixed' | 'inconclusive'
export type PilotAssessment = {
  cause: PilotCause
  confidence: 'high' | 'low'
  explanation: string
  evidences: Array<{message_id: string; quote: string}>
  human_contribution: boolean | null
  exclusion_eligible: false
  pattern: 'none'
  validation_errors: string[]
}

export function validatePilotAssessment(input: unknown, prepared: PreparedEvidence): PilotAssessment {
  const raw = record(input)
  const errors: string[] = []
  if (!prepared.ready) errors.push('evidence_not_ready')
  const allowed: PilotCause[] = ['human', 'system', 'other_external', 'mixed', 'inconclusive']
  const requestedCause = allowed.includes(raw.cause as PilotCause) ? raw.cause as PilotCause : 'inconclusive'
  if (!allowed.includes(raw.cause as PilotCause)) errors.push('cause_invalid')
  const explanation = string(raw.explanation).trim()
  if (explanation.length < 30 || explanation.length > 1500) errors.push('explanation_invalid')
  const confidence = raw.confidence === 'high' ? 'high' : 'low'
  const evidences: PilotAssessment['evidences'] = []
  const rawEvidence = Array.isArray(raw.evidences) ? raw.evidences : []
  if (rawEvidence.length > 3 || requestedCause !== 'inconclusive' && rawEvidence.length === 0) errors.push('evidence_count_invalid')
  const seen = new Set<string>()
  let ownPublicEvidence = false
  for (const value of rawEvidence) {
    const item = record(value), messageId = string(item.message_id), quote = string(item.quote)
    const message = prepared.messages.find(m => m.id === messageId)
    if (!message || quote.trim().length < 12 || quote.length > 300 || !message.text.includes(quote) || seen.has(messageId + '\n' + quote)) {
      errors.push('evidence_reference_invalid'); continue
    }
    seen.add(messageId + '\n' + quote)
    evidences.push({message_id: messageId, quote})
    if (message.visibility === 'public' && ['agent', 'human'].includes(message.authorType) && identity(message.authorName) === identity(prepared.analystName)) ownPublicEvidence = true
  }
  const human = typeof raw.human_contribution === 'boolean' ? raw.human_contribution : null
  if (['human', 'mixed'].includes(requestedCause) && (!ownPublicEvidence || human !== true)) errors.push('own_public_evidence_required')
  if (['system', 'other_external'].includes(requestedCause) && human !== false) errors.push('human_contribution_invalid')
  if (requestedCause !== 'inconclusive' && confidence !== 'high') errors.push('confidence_insufficient')
  return {
    cause: errors.length ? 'inconclusive' : requestedCause,
    confidence: errors.length ? 'low' : confidence,
    explanation: explanation.slice(0, 1500), evidences,
    human_contribution: human, exclusion_eligible: false, pattern: 'none',
    validation_errors: [...new Set(errors)],
  }
}

export function combinePilotAssessments(first: PilotAssessment, second: PilotAssessment) {
  const agreement = first.cause === second.cause && first.cause !== 'inconclusive'
    && first.confidence === 'high' && second.confidence === 'high'
    && first.validation_errors.length === 0 && second.validation_errors.length === 0
  return {
    ...second,
    cause: agreement ? second.cause : 'inconclusive' as PilotCause,
    confidence: agreement ? 'high' as const : 'low' as const,
    exclusion_eligible: false as const, pattern: 'none' as const,
    two_pass_agreement: agreement, first_pass: first, second_pass: second,
  }
}

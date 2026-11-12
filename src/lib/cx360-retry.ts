/** Infrastructure outages must not consume the case's evidence-validation attempts. */
export function cxRetry(code: string, attempts: number) {
  const temporary = /^(provider_(rate_limit|http_(408|429|5\d\d))|source_(rate_limit|unavailable)|network_timeout)$/.test(code)
  return { status: attempts >= 3 && !temporary ? 'failed' : 'pending',
    attempts: temporary ? Math.max(0, attempts - 1) : attempts,
    delayMs: temporary ? 300000 : Math.min(1800000, 60000 * 2 ** Math.max(0, attempts - 1)), temporary }
}

/** Fixed diagnostic labels only; provider output and conversation text never reach logs. */
export function cxValidationDetail(error: unknown): string | null {
 const message=(error as {message?:unknown}|null)?.message
 if(typeof message!=='string')return null
 const labels:Record<string,string>={
  'Análise inválida.':'diagnosis_shape',
  'Classificação inválida.':'diagnosis_classification',
  'Análise incompleta.':'diagnosis_fields',
  'Análise sem referências verificáveis no histórico anterior à nota.':'diagnosis_references',
  'Limitações ausentes.':'diagnosis_limitations',
  'Avaliação humana incompleta: seis critérios obrigatórios.':'service_criteria_count',
  'Critério humano sem evidência verificável.':'service_criterion_shape_or_references',
  'Conduta sem mensagem pública da pessoa avaliada.':'service_criterion_authorship',
  'Falha humana sem prova específica para revisão crítica.':'human_gap_support',
 }
 return labels[message]??null
}

/** Only fixed codes are persisted: never leak a provider payload or customer text. */
export function cxErrorCode(error: unknown): string {
 const failure=error as {name?:unknown;message?:unknown}|null
 if(!failure||typeof failure.message!=='string')return 'analysis_unavailable'
 if(failure.name==='SyntaxError')return 'provider_invalid_json'
 if(['TimeoutError','AbortError','TypeError'].includes(String(failure.name)))return 'network_timeout'
 if(/^(provider_(rate_limit|incomplete|invalid_review|not_configured|http_\d{3})|invalid_model|lease_or_source_changed)$/.test(failure.message))return failure.message
 const sourceErrors:Record<string,string>={
  'Histórico de mensagens indisponível.':'source_history_missing',
  'Histórico paginado exige leitura integral.':'source_history_paginated',
  'Mensagem sem horário verificável.':'source_message_timestamp_invalid',
  'Mensagem sem identificador verificável.':'source_message_id_invalid',
  'Histórico extenso: requer leitura específica, sem truncamento silencioso.':'source_history_too_large',
 }
 if(sourceErrors[failure.message])return sourceErrors[failure.message]
 if(/^(Análise inválida\.|Classificação inválida\.|Análise incompleta\.|Análise sem referências verificáveis no histórico anterior à nota\.|Limitações ausentes\.|Avaliação humana incompleta: seis critérios obrigatórios\.|Critério humano sem evidência verificável\.|Conduta sem mensagem pública da pessoa avaliada\.|Falha humana sem prova específica para revisão crítica\.)$/.test(failure.message))return 'provider_evidence_invalid'
 return 'analysis_unavailable'
}

/** Projection of the source report. These rows never feed performance or podium. */
export function sourceReportScope(params: URLSearchParams, cutoff: string) {
  const allowed = ['start', 'end', 'department_id']
  if ([...params.keys()].some(key => !allowed.includes(key) || params.getAll(key).length !== 1)) throw new Error('Filtros inválidos.')
  const valid = (s: string) => /^20\d{2}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s
  const start = params.get('start') ?? '', requestedEnd = params.get('end') ?? ''
  const department = params.get('department_id') ?? ''
  if (!valid(start) || !valid(requestedEnd) || !['3', '12'].includes(department)) throw new Error('Selecione datas válidas e uma fila ERP ou Fiscal.')
  const end = requestedEnd < cutoff ? requestedEnd : cutoff
  if (start > end || Date.parse(end) - Date.parse(start) > 31 * 86400000) throw new Error('Selecione até 32 dias fechados, até D-1.')
  return { start, end, department_id: Number(department) }
}

export function sourceReportRows(payload: unknown) {
  const root = payload as { agents?: Record<string, unknown>[] }
  if (!Array.isArray(root?.agents)) throw new Error('Relatório da fonte indisponível.')
  const count = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new Error('Contagem inválida na fonte.')
    return v
  }
  const nullable = (v: unknown, percentage = false) => {
    if (v === null) return null
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (percentage && v > 100)) throw new Error('Indicador inválido na fonte.')
    return v
  }
  const seen = new Set<number>()
  return root.agents.map(row => {
    const id = count(row.id)
    if (seen.has(id) || typeof row.name !== 'string' || !row.name.trim()) throw new Error('Identidade inválida na fonte.')
    seen.add(id)
    return { id, name: row.name, responded: count(row.conversations), resolved: count(row.resolved),
      transferred: count(row.transfers_out), first_response_seconds: nullable(row.first_response_seconds),
      handle_seconds: nullable(row.handle_seconds), sla_pct: nullable(row.sla_pct, true),
      first_contact_pct: nullable(row.first_contact_pct, true), reopened_pct: nullable(row.reopened_pct, true),
      csat_pct: nullable(row.csat_pct, true), reviews: count(row.csat_total) }
  })
}

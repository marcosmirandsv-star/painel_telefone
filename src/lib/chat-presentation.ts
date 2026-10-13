/** Presentation only: never combine areas, recalculate metrics or invent missing data. */
export function selectChatPresentationRow<T extends { analyst_id: string | null }>(rows: readonly T[], analystId: string | null | undefined) {
  const matches = analystId ? rows.filter(row => row.analyst_id === analystId) : []
  return { row: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 }
}

export function chatBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function chatPeriodBounds(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Competência inválida')
  const [year, number] = month.split('-').map(Number)
  return { start: `${month}-01`, end: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) }
}

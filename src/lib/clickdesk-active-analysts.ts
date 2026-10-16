/**
 * Operational team dashboards include active Chat analysts only.
 * Inactive employees' audited tickets remain in the ledger unchanged and
 * can be inspected separately in historical/explicit analyst views.
 * Unknown analyst IDs are not silently dropped.
 */
export function partitionChatLedgerByActiveRoster<T extends { analyst_id: string }>(
  tickets: T[],
  analysts: Array<{ id: string; active: boolean }>,
): { active: T[]; inactive: T[] } {
  const status = new Map(analysts.map(item => [item.id, item.active]))
  const active: T[] = []
  const inactive: T[] = []
  for (const ticket of tickets) {
    const isActive = status.get(ticket.analyst_id)
    if (isActive === undefined) throw new Error('ledger_author_without_registered_analyst')
    if (isActive) active.push(ticket)
    else inactive.push(ticket)
  }
  return { active, inactive }
}

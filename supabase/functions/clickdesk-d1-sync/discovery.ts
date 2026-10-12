/**
 * ClickDesk REST ticket discovery used for recovery and intraday scanning.
 * The old /tickets?inbox=conversations&attendance=human endpoint returned
 * 0 records despite official agent reports showing activity (October 2026).
 * This endpoint was verified with real, read-only discovery calls.
 */
export const PAGE_SIZE = 500

export function clickdeskDiscoveryPath(page: number): string {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid discovery page')
  return '/tickets?inbox=all&view=all&stage=team&sort=id&dir=desc&per_page=' +
    PAGE_SIZE + '&page=' + page
}

/** A malformed envelope is a failure, not an empty day of work. */
export function extractClickdeskRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') throw new Error('Unexpected ClickDesk collection')
  const source = payload as Record<string, unknown>
  for (const key of ['data','items','results','tickets','conversations','messages','events']) {
    const value = source[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = value as Record<string, unknown>
      for (const child of ['data','items','results','tickets','messages','events']) {
        if (Array.isArray(inner[child])) return inner[child] as unknown[]
      }
    }
  }
  throw new Error('Unrecognized ClickDesk collection envelope')
}

/**
 * Pagination metadata is required before accepting coverage as complete.
 * Discover by confirmed API shape; don't silently assume last_page=1.
 */
export function ticketDiscoveryLastPage(payload: unknown): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Missing ClickDesk ticket pagination')
  const source = payload as Record<string, unknown>
  const data = source.data && typeof source.data === 'object' && !Array.isArray(source.data)
    ? source.data as Record<string,unknown> : {}
  const m = source.meta && typeof source.meta === 'object' && !Array.isArray(source.meta)
    ? source.meta as Record<string,unknown> : {}
  const meta = [source, m, source.pagination, m.pagination, data.meta, data.pagination]
  for (const item of meta) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const value = record.last_page ?? record.lastPage ?? record.total_pages
    if (value === undefined || value === null) continue
    const count = Number(value)
    if (Number.isSafeInteger(count) && count >= 1) return count
  }
  throw new Error('Missing ClickDesk last_page: cannot prove complete discovery')
}

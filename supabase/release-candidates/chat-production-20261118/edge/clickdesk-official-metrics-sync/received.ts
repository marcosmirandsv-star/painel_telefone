function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** An individual's received volume is the header of a single-owner report, never agent.conversations. */
export function receivedCount(payload: unknown): number {
  const root = record(payload)
  const count = record(record(root.summary).received).value
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('Missing or invalid single-owner received count')
  }
  return count
}

export function receivedForOwner(payload: unknown, ownerId: number): number {
  const root = record(payload)
  if (!Array.isArray(root.agents) || root.agents.some(row => record(row).id !== ownerId)) {
    throw new Error('Single-owner report returned an unexpected owner')
  }
  return receivedCount(payload)
}

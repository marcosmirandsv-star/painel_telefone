import type { DepartmentEvent, HumanMessage } from './clickdesk-human-capture'

type JsonRecord = Record<string, unknown>

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord : {}
}

function string(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function first(...values: unknown[]): string {
  for (const value of values) {
    const normalized = string(value)
    if (normalized) return normalized
  }
  return ''
}

/**
 * Read ClickDesk REST collections; the API can wrap the array in data.data.
 * Never silently claim a non-empty malformed object to be an empty collection.
 */
export function extractRestRecords(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const source = object(payload)
  for (const key of ['data', 'items', 'results', 'tickets', 'events', 'messages']) {
    const value = source[key]
    if (Array.isArray(value)) return value
    const nested = object(value)
    for (const subkey of ['data', 'items', 'results', 'tickets', 'events', 'messages']) {
      if (Array.isArray(nested[subkey])) return nested[subkey] as unknown[]
    }
  }
  throw new Error('ClickDesk REST: coleção ausente ou formato desconhecido')
}

/** Do not convert private/unknown visibility into public. */
export function normalizeRestMessage(value: unknown): HumanMessage {
  const row = object(value)
  const author = object(row.author)
  const agent = object(row.agent)
  const sender = object(row.sender)
  const visibility = first(row.visibility) ||
    (row.public === true || row.is_public === true ? 'public' : '') ||
    (row.public === false || row.is_public === false ? 'private' : '')
  return {
    id: first(row.id, row.message_id),
    created_at: first(row.created_at, row.createdAt, row.sent_at, row.timestamp, row.date),
    author_type: first(row.author_type, author.type, row.role),
    visibility: visibility.toLowerCase(),
    author: first(row.author_name, author.name, row.author, sender.name, agent.name) || null,
  }
}

/** Events are optional context; the queue never decides whether human work counts. */
export function normalizeRestEvent(value: unknown): DepartmentEvent {
  const row = object(value)
  return {
    id: first(row.id, row.event_id),
    created_at: first(row.created_at, row.createdAt, row.occurred_at, row.timestamp, row.date),
    field: first(row.field, row.attribute),
    new: first(row.new, row.to, row.new_value, row.value) || null,
  }
}

export function unwrapRestTicket(payload: unknown): JsonRecord {
  const root = object(payload)
  const data = object(root.data)
  if (Object.keys(data).length) return data
  const ticket = object(root.ticket)
  return Object.keys(ticket).length ? ticket : root
}

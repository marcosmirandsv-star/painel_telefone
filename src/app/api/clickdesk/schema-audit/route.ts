import { NextResponse } from 'next/server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAPI_URL =
  'https://api.desk.click.app/api/v1/public/docs/api/openapi.json?host=clickdesk.ai'

function collectTimestampLikeFields(
  value: unknown,
  path = '$',
  depth = 0,
  out = new Map<string, unknown>(),
) {
  if (!value || typeof value !== 'object' || depth > 10) return out

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectTimestampLikeFields(item, `${path}[${index}]`, depth + 1, out),
    )
    return out
  }

  const source = value as Record<string, unknown>
  for (const [key, raw] of Object.entries(source)) {
    const currentPath = `${path}.${key}`
    if (
      /(created|updated|closed|ended|started|opened|assigned|claimed|transferred|resolved|finished|timestamp|date|time)/i.test(
        key,
      )
    ) {
      out.set(currentPath, raw)
    }
    collectTimestampLikeFields(raw, currentPath, depth + 1, out)
  }

  return out
}

function summarizeOperation(operation: unknown) {
  if (!operation || typeof operation !== 'object') return null
  const source = operation as Record<string, unknown>
  const parameters = Array.isArray(source.parameters)
    ? source.parameters
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const parameter = item as Record<string, unknown>
          return {
            name: parameter.name ?? null,
            in: parameter.in ?? null,
            description: parameter.description ?? null,
            schema: parameter.schema ?? null,
          }
        })
        .filter(Boolean)
    : []

  const timestampFields = [
    ...collectTimestampLikeFields({
      requestBody: source.requestBody,
      responses: source.responses,
    }).entries(),
  ].map(([path, value]) => ({ path, value }))

  return {
    summary: source.summary ?? null,
    description: source.description ?? null,
    parameters,
    timestamp_fields: timestampFields.slice(0, 200),
  }
}

export async function GET() {
  const { environment } = getServerSupabaseConfig()
  if (environment !== 'homologacao') {
    return NextResponse.json({ error: 'Disponível somente em homologação.' }, { status: 404 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12000)

  try {
    const response = await fetch(OPENAPI_URL, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `OpenAPI respondeu HTTP ${response.status}.` },
        { status: 502 },
      )
    }

    const openapi = (await response.json()) as Record<string, unknown>
    const paths =
      openapi.paths && typeof openapi.paths === 'object'
        ? (openapi.paths as Record<string, unknown>)
        : {}

    const ticketList =
      paths['/tickets'] && typeof paths['/tickets'] === 'object'
        ? (paths['/tickets'] as Record<string, unknown>).get
        : null
    const ticketDetail =
      paths['/tickets/{ticket}'] && typeof paths['/tickets/{ticket}'] === 'object'
        ? (paths['/tickets/{ticket}'] as Record<string, unknown>).get
        : null

    const ticketPathNames = Object.keys(paths).filter((path) => path.startsWith('/tickets'))

    return NextResponse.json({
      openapi: openapi.openapi ?? null,
      title:
        openapi.info && typeof openapi.info === 'object'
          ? (openapi.info as Record<string, unknown>).title ?? null
          : null,
      ticket_paths: ticketPathNames,
      ticket_list: summarizeOperation(ticketList),
      ticket_detail: summarizeOperation(ticketDetail),
      audited_at: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Falha ao auditar OpenAPI.' },
      { status: 502 },
    )
  } finally {
    clearTimeout(timeout)
  }
}

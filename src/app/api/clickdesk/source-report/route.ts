import { ApiError, authorizeManagerSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { clickDeskPublicationDay } from '@/lib/clickdesk-publication'
import { sourceReportRows, sourceReportScope } from '@/lib/clickdesk-source-report'

export const runtime = 'nodejs'
export async function GET(request: Request) { return handle(async () => {
  if (getServerSupabaseConfig().environment !== 'homologacao') throw new ApiError(404, 'Conferência disponível somente na homologação.')
  await authorizeManagerSessionClient(request)
  let scope
  try { scope = sourceReportScope(new URL(request.url).searchParams, clickDeskPublicationDay()) }
  catch (error) { throw new ApiError(400, (error as Error).message) }
  const apiKey = process.env.CLICKDESK_API_KEY, account = process.env.CLICKDESK_ACCOUNT_ID
  if (!apiKey || !account) throw new ApiError(503, 'Integração ClickDesk indisponível.')
  const params = new URLSearchParams({ from: scope.start, to: scope.end, department_id: String(scope.department_id) })
  const response = await fetch(`https://api.desk.click.app/api/v1/support/reports/agents?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'X-Account-Id': account, Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 503, 'Não foi possível consultar o relatório ClickDesk. Tente novamente.')
  let rows
  try { rows = sourceReportRows(await response.json()) }
  catch { throw new ApiError(503, 'Formato do relatório ClickDesk não pôde ser conferido.') }
  return json({ scope, rows, captured_at: new Date().toISOString(), source: 'clickdesk_agents_report',
    note: 'Relatório da fila, incluindo participantes externos ao time e aprendizes quando retornados pela fonte. Não altera performance, metas ou pódio. Respondidos e resolvidos são medidas diferentes.' })
}) }

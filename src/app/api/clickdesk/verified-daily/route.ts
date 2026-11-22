import { isChatProductionEnabled } from '@/lib/chat-production-gate'
import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/chat-integration-server'

export const runtime = 'nodejs'

type DailyRow = {
  occurred_date: string
  source_owner_name: string
  source_owner_key: string
  attendances: number
  positive_reviews: number
  negative_reviews: number
}
type Analyst = { id: string; name: string; team_id: string | null; active: boolean }

function validDate(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function datesBetween(start: string, end: string) {
  const days: string[] = []
  for (let date = start; date <= end; date = new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)) {
    days.push(date)
  }
  return days
}

/** Read-only. Manager-only verified daily snapshots, never estimated from the month. */
export async function GET(request: Request) {
  return handle(async () => {
    if (!isChatProductionEnabled()) throw new ApiError(404, 'Consulta diária indisponível.')
    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) throw new ApiError(403, 'Consulta coletiva exclusiva da gestão.')
    const params = new URL(request.url).searchParams
    const allowed = ['start', 'end', 'team_id']
    for (const key of params.keys()) {
      if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, 'Filtro inválido.')
    }
    const start = params.get('start') ?? ''
    const end = params.get('end') ?? ''
    const teamId = params.get('team_id') ?? ''
    const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date())
    if (!validDate(start) || !validDate(end) || start > end || end > today ||
        start < '2026-10-01' || start.slice(0, 7) !== end.slice(0, 7)) {
      throw new ApiError(400, 'Selecione datas válidas dentro da mesma competência.')
    }
    const expectedDates = datesBetween(start, end)
    if (expectedDates.length > 31) throw new ApiError(400, 'O período máximo é de 31 dias.')
    if (teamId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(teamId)) {
      throw new ApiError(400, 'Equipe inválida.')
    }

    const [roster, response] = await Promise.all([
      access.admin.from('chat_analysts').select('id,name,team_id,active').eq('active', true),
      access.admin.rpc('get_scoped_clickdesk_official_daily_metrics', { p_start: start, p_end: end }),
    ])
    if (roster.error || response.error) throw new ApiError(503, 'Não foi possível conferir as capturas diárias oficiais.')
    const active = (roster.data ?? []) as Analyst[]
    const ownerTeam = new Map(active.map(a => [normalize(a.name), a.team_id]))
    if (active.length === 0) throw new ApiError(503, 'Quadro oficial dos analistas indisponível.')
    if (teamId && !active.some(a => a.team_id === teamId)) throw new ApiError(400, 'Equipe fora do quadro ativo.')

    // One official owner snapshot per expected active owner is required to
    // declare this one day verified. A gap means unknown, never zero.
    const byDate = new Map<string, DailyRow[]>()
    for (const row of (response.data ?? []) as DailyRow[]) {
      if (!expectedDates.includes(row.occurred_date)) continue
      const entries = byDate.get(row.occurred_date) ?? []
      entries.push(row)
      byDate.set(row.occurred_date, entries)
    }
    const days = expectedDates.map(date => {
      const rows = byDate.get(date) ?? []
      const keys = new Set(rows.map(r => normalize(r.source_owner_name)))
      const verified = rows.length === active.length && keys.size === active.length &&
        [...keys].every(key => ownerTeam.has(key)) &&
        rows.every(row => Number.isInteger(Number(row.attendances)) && Number(row.attendances) >= 0)
      if (!verified) return { date, verified: false, attendances: null, positive_reviews: null, negative_reviews: null }
      const scoped = teamId ? rows.filter(row => ownerTeam.get(normalize(row.source_owner_name)) === teamId) : rows
      return {
        date,
        verified: true,
        attendances: scoped.reduce((n, r) => n + Number(r.attendances), 0),
        positive_reviews: scoped.reduce((n, r) => n + Number(r.positive_reviews), 0),
        negative_reviews: scoped.reduce((n, r) => n + Number(r.negative_reviews), 0),
      }
    })
    return json({
      source: 'clickdesk_official_exact_day_snapshots',
      start, end, team_id: teamId || null,
      expected_days: expectedDates.length,
      verified_days: days.filter(d => d.verified).length,
      month_reconciled: false,
      note: 'Dias individuais capturados diretamente no ClickDesk. A soma e a distribuição mensal ainda exigem conciliação. Datas sem captura não são tratadas como zero.',
      days,
    })
  })
}

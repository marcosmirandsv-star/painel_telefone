'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type VerifiedDay = {
  date: string
  verified: boolean
  attendances: number | null
  positive_reviews: number | null
  negative_reviews: number | null
}
type DailyResult = {
  source: string
  expected_days: number
  verified_days: number
  month_reconciled: boolean
  note: string
  days: VerifiedDay[]
}

const count = (value: number) => new Intl.NumberFormat('pt-BR').format(value)
const dateLabel = (value: string) => value.split('-').reverse().join('/')

export default function ClickDeskVerifiedDailyVolume({
  start,
  end,
  teamId,
  periodReceived,
  individual = false,
  onDaySelect,
}: {
  start: string
  end: string
  teamId: string
  periodReceived: number
  individual?: boolean
  onDaySelect?: (date: string) => void
}) {
  const [data, setData] = useState<DailyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [highlighted, setHighlighted] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    setLoading(true)
    setData(null)
    setError('')
    setHighlighted(null)

    async function refresh() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente.')
        const params = new URLSearchParams({ start, end })
        if (teamId !== 'all') params.set('team_id', teamId)
        const response = await fetch('/api/clickdesk/verified-daily?' + params.toString(), {
          cache: 'no-store', headers: { Authorization: 'Bearer ' + session.access_token },
        })
        const json = await response.json()
        if (!response.ok) throw new Error(json.erro || 'Não foi possível conferir os dias.')
        if (!cancelled) { setData(json); setError('') }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Consulta diária indisponível.')
      } finally {
        if (!cancelled) setLoading(false)
      }
      // Keep verified daily captures current without modifying or collecting data.
      if (!cancelled) timer = setTimeout(() => { void refresh() }, 60000)
    }

    if (start && end) void refresh()
    else { setLoading(false); setData(null) }
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [start, end, teamId, refreshKey])

  const confirmed = useMemo(() => (data?.days ?? []).filter(d => d.verified && d.attendances !== null), [data])
  const dailyTotal = confirmed.reduce((sum, d) => sum + (d.attendances ?? 0), 0)
  const max = Math.max(1, ...confirmed.map(d => d.attendances ?? 0))
  const peak = [...confirmed].sort((a,b) => (b.attendances ?? 0) - (a.attendances ?? 0))[0] ?? null
  const chosen = confirmed.find(d => d.date === highlighted) ?? peak
  const average = confirmed.length
    ? Math.round(confirmed.reduce((sum,d) => sum + (d.attendances ?? 0), 0) / confirmed.length)
    : null

  return <div className="verified-daily-wrap" aria-label="Histórico diário confirmado">
    <div className="verified-daily-heading">
      <div>
        <span className="verified-daily-eyebrow">Evolução diária · ClickDesk</span>
        <h4>Atendimentos por dia</h4>
        <p>{individual ? 'Suas capturas oficiais diárias, ainda sujeitas à conciliação. Clique em um dia conferido para consultar seus tickets.' : 'Somente datas com captura oficial completa por analista. Dias ainda não verificados permanecem sem valor.'}</p>
      </div>
      <div className="verified-daily-actions">
        {data && <span className="verified-daily-coverage">{data.verified_days} de {data.expected_days} dias conferidos</span>}
        <button type="button" className="chat-app-back-link"
          onClick={() => setRefreshKey(v => v + 1)} disabled={loading}>
          {loading ? 'Atualizando...' : 'Atualizar dias'}
        </button>
      </div>
    </div>

    {error && <p className="verified-daily-error" role="alert">{error}</p>}
    <div className="verified-daily-kpis">
      <div><span>Recebidos no período</span><strong>{count(periodReceived)}</strong><small>Total oficial acumulado</small></div>
      <div><span>Média dos dias conferidos</span><strong>{average === null ? '—' : count(average)}</strong><small>Não representa a média do mês completo</small></div>
      <div><span>Pico entre os dias conferidos</span><strong>{peak?.attendances === null || !peak ? '—' : count(peak.attendances ?? 0)}</strong>
        <small>{peak ? dateLabel(peak.date) : 'Aguardando capturas'}</small></div>
    </div>

    {data && <p role="status">Soma dos dias conferidos: {count(dailyTotal)} · Diferença (soma diária menos total oficial): {count(dailyTotal - periodReceived)}. {data.verified_days !== data.expected_days ? 'Cobertura parcial; diferença não conclusiva.' : 'Conciliação definitiva ainda em conferência.'}</p>}
    <div className="verified-daily-chart" role="group" aria-label="Atendimentos por data, somente dias confirmados">
      <div className="verified-daily-axis" aria-hidden="true"><span>{count(max)}</span><span>0</span></div>
      <div className="verified-daily-chart-scroll">
        <div className="verified-daily-bars">
          {(data?.days ?? []).map(day => (
            <button type="button" key={day.date} className={'verified-daily-day' + (day.verified ? ' is-verified' : ' is-missing')}
              title={day.verified ? dateLabel(day.date) + ': ' + count(day.attendances ?? 0) + ' atendimentos' : dateLabel(day.date) + ': captura pendente'}
              onClick={() => { if (day.verified) onDaySelect?.(day.date) }}
              onMouseEnter={() => setHighlighted(day.verified ? day.date : null)}
              onMouseLeave={() => setHighlighted(null)}
              onFocus={() => setHighlighted(day.verified ? day.date : null)}
              onBlur={() => setHighlighted(null)}
              aria-label={day.verified ? dateLabel(day.date) + ', ' + count(day.attendances ?? 0) + ' recebidos' : dateLabel(day.date) + ', sem captura oficial'}
              aria-pressed={highlighted === day.date}>
              <span className="verified-daily-bar-track">
                {day.verified ? <span className="verified-daily-bar-fill"
                  style={{ height: Math.max(day.attendances === 0 ? 3 : 6, ((day.attendances ?? 0) / max) * 100) + '%' }} />
                : <span className="verified-daily-bar-missing" />}
              </span>
              <span className="verified-daily-day-label">{day.date.slice(-2)}</span>
            </button>
          ))}
          {loading && !data && <span className="verified-daily-loading" role="status">Consultando capturas oficiais...</span>}
        </div>
      </div>
    </div>
    <div className="verified-daily-foot">
      <span>{chosen ? 'Dia em destaque: ' + dateLabel(chosen.date) + ' · ' + count(chosen.attendances ?? 0) + ' recebidos' : 'Ainda não há dias confirmados para este intervalo.'}</span>
      <span>Capturas individuais não substituem a conciliação do total mensal.</span>
    </div>
  </div>
}

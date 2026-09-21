'use client'

import { useEffect, useMemo, useState } from 'react'
import { scheduleSupabase as supabase } from '@/lib/schedule-supabase'
import type {
  ScheduleEntry,
  ScheduleMembership,
  SchedulePerson,
  ScheduleTeam,
} from '@/lib/schedule-types'

type TransportBenefit = {
  id: string
  person_id: string
  benefit_type: 'VALE_TRANSPORTE'
  start_date: string
  end_date: string | null
  active: boolean
  notes: string | null
}

type TransportSubmission = {
  id: string
  year: number
  month: number
  status: 'PENDING' | 'SENT'
  sent_at: string | null
  sent_by: string | null
  notes: string | null
  snapshot: unknown[]
}

type Props = {
  year: number
  month: number
  people: SchedulePerson[]
  memberships: ScheduleMembership[]
  entries: ScheduleEntry[]
  teams: ScheduleTeam[]
  profileId: string | null
}

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']

function ymd(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function monthRange(year: number, month: number) {
  const start = `${ymd(year, month)}-01`
  const end = new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10)
  return { start, end }
}

function previousDay(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value.includes('T') ? value : `${value}T12:00:00`).toLocaleDateString('pt-BR')
}

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""')
  return `"${text}"`
}

export function ScheduleTransportPanel({
  year,
  month,
  people,
  memberships,
  entries,
  teams,
  profileId,
}: Props) {
  const [benefits, setBenefits] = useState<TransportBenefit[]>([])
  const [submission, setSubmission] = useState<TransportSubmission | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const { start: monthStart, end: monthEnd } = useMemo(() => monthRange(year, month), [year, month])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [benefitsResult, submissionResult] = await Promise.all([
        supabase
          .from('schedule_transport_benefits')
          .select('*')
          .eq('benefit_type', 'VALE_TRANSPORTE')
          .order('start_date'),
        supabase
          .from('schedule_transport_submissions')
          .select('*')
          .eq('year', year)
          .eq('month', month)
          .maybeSingle(),
      ])

      if (cancelled) return
      if (benefitsResult.error) setMessage(benefitsResult.error.message)
      setBenefits((benefitsResult.data ?? []) as TransportBenefit[])
      setSubmission((submissionResult.data as TransportSubmission | null) ?? null)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [month, year])

  const activePeople = useMemo(
    () => people.filter((person) => person.active),
    [people],
  )

  function benefitForMonth(personId: string) {
    return benefits.find(
      (benefit) =>
        benefit.person_id === personId &&
        benefit.start_date <= monthEnd &&
        (!benefit.end_date || benefit.end_date >= monthStart),
    )
  }

  function teamNamesForMonth(personId: string) {
    const names = memberships
      .filter(
        (membership) =>
          membership.person_id === personId &&
          membership.participates_in_schedule &&
          membership.start_date <= monthEnd &&
          (!membership.end_date || membership.end_date >= monthStart),
      )
      .map((membership) => teams.find((team) => team.id === membership.team_id)?.name)
      .filter((name): name is string => Boolean(name))

    return [...new Set(names)].join(' / ') || 'Sem time'
  }

  function presenceDays(personId: string) {
    return entries.filter(
      (entry) =>
        entry.person_id === personId &&
        entry.entry_type === 'hybrid' &&
        entry.date >= monthStart &&
        entry.date <= monthEnd &&
        (entry.value === 'P' || entry.value === 'CLICK_DAY'),
    ).length
  }

  function hybridRows(personId: string) {
    return entries.filter(
      (entry) =>
        entry.person_id === personId &&
        entry.entry_type === 'hybrid' &&
        entry.date >= monthStart &&
        entry.date <= monthEnd,
    ).length
  }

  const beneficiaries = useMemo(
    () =>
      activePeople
        .filter((person) => Boolean(benefitForMonth(person.id)))
        .map((person) => ({
          person,
          team: teamNamesForMonth(person.id),
          days: presenceDays(person.id),
          hasSchedule: hybridRows(person.id) > 0,
          benefit: benefitForMonth(person.id)!,
        }))
        .sort((a, b) => a.person.name.localeCompare(b.person.name)),
    // benefits and entries intentionally drive the derived monthly report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePeople, benefits, entries, memberships, monthEnd, monthStart, teams],
  )

  const totalPresenceDays = beneficiaries.reduce((sum, item) => sum + item.days, 0)

  async function toggleBenefit(person: SchedulePerson) {
    const current = benefitForMonth(person.id)

    if (current) {
      if (current.start_date >= monthStart) {
        const { error } = await supabase
          .from('schedule_transport_benefits')
          .delete()
          .eq('id', current.id)
        if (error) return setMessage(error.message)
        setBenefits((items) => items.filter((item) => item.id !== current.id))
      } else {
        const endDate = previousDay(monthStart)
        const { data, error } = await supabase
          .from('schedule_transport_benefits')
          .update({
            end_date: endDate,
            active: false,
            updated_at: new Date().toISOString(),
          })
          .eq('id', current.id)
          .select('*')
          .single()
        if (error) return setMessage(error.message)
        setBenefits((items) => items.map((item) => item.id === current.id ? data as TransportBenefit : item))
      }
      setMessage(`${person.name} não será considerado(a) no vale-transporte de ${MONTHS[month - 1]}.`)
      return
    }

    const { data, error } = await supabase
      .from('schedule_transport_benefits')
      .insert({
        person_id: person.id,
        benefit_type: 'VALE_TRANSPORTE',
        start_date: monthStart,
        active: true,
        created_by: profileId || null,
      })
      .select('*')
      .single()

    if (error) return setMessage(error.message)
    setBenefits((items) => [...items, data as TransportBenefit])
    setMessage(`${person.name} incluído(a) no vale-transporte a partir de ${formatDate(monthStart)}.`)
  }

  function reportSnapshot() {
    return beneficiaries.map((item) => ({
      person_id: item.person.id,
      nome: item.person.name,
      time: item.team,
      dias_presenciais: item.days,
      escala_disponivel: item.hasSchedule,
    }))
  }

  async function markSent() {
    const payload = {
      year,
      month,
      status: 'SENT',
      sent_at: new Date().toISOString(),
      sent_by: profileId || null,
      snapshot: reportSnapshot(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('schedule_transport_submissions')
      .upsert(payload, { onConflict: 'year,month' })
      .select('*')
      .single()

    if (error) return setMessage(error.message)
    setSubmission(data as TransportSubmission)
    setMessage('Envio ao Departamento Pessoal registrado.')
  }

  function exportCsv() {
    const header = ['Colaborador','Time','Dias presenciais','Período']
    const rows = beneficiaries.map((item) => [
      item.person.name,
      item.team,
      item.days,
      `${MONTHS[month - 1]}/${year}`,
    ])

    const csv = [
      header.map(csvCell).join(';'),
      ...rows.map((row) => row.map(csvCell).join(';')),
    ].join('\n')

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `vale-transporte-${year}-${String(month).padStart(2, '0')}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function copyReport() {
    const lines = [
      `Vale-transporte — ${MONTHS[month - 1]} de ${year}`,
      '',
      ...beneficiaries.map((item) => `${item.person.name} — ${item.days} dia(s) presencial(is)`),
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setMessage('Resumo copiado para a área de transferência.')
    } catch {
      setMessage('Não foi possível copiar automaticamente neste navegador.')
    }
  }

  const now = new Date()
  const currentPeriod = now.getFullYear() === year && now.getMonth() + 1 === month
  const currentDay = now.getDate()
  let deadlineTitle = `Janela de envio: 17 a 19/${String(month).padStart(2, '0')}`
  let deadlineDetail = 'Prepare a conferência antes do envio ao Departamento Pessoal.'
  let deadlineTone = 'schedule-transport-neutral'

  if (submission?.status === 'SENT') {
    deadlineTitle = 'Enviado ao Departamento Pessoal'
    deadlineDetail = submission.sent_at
      ? `Registro de envio em ${new Date(submission.sent_at).toLocaleString('pt-BR')}.`
      : 'Envio registrado.'
    deadlineTone = 'schedule-transport-success'
  } else if (currentPeriod && currentDay >= 17 && currentDay <= 19) {
    deadlineTitle = 'Janela de envio aberta'
    deadlineDetail = 'O relatório deste mês já pode ser conferido e enviado ao DP.'
    deadlineTone = 'schedule-transport-warning'
  } else if (currentPeriod && currentDay > 19) {
    deadlineTitle = 'Envio ao DP pendente'
    deadlineDetail = 'A janela de 17 a 19 já passou e este mês ainda não foi marcado como enviado.'
    deadlineTone = 'schedule-transport-danger'
  }

  if (loading) {
    return <section className="schedule-card mt-6 p-5">Carregando vale-transporte...</section>
  }

  return (
    <div className="mt-6 grid gap-5">
      {message && <div className="schedule-inline-note">{message}</div>}

      <section className="schedule-card p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="schedule-kicker">Departamento Pessoal</p>
            <h2 className="schedule-heading mt-1 text-xl font-bold">Vale-transporte</h2>
            <p className="schedule-subtitle mt-2 max-w-3xl text-sm">
              O sistema usa a escala híbrida do mês para contar quantos dias cada beneficiário estará presencialmente na empresa.
              Presencial e Click Day contam como dia de deslocamento.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={copyReport} disabled={!beneficiaries.length}>Copiar resumo</button>
            <button className="secondary-button" onClick={exportCsv} disabled={!beneficiaries.length}>Baixar CSV para o DP</button>
            <button className="primary-button" onClick={markSent} disabled={!beneficiaries.length}>Marcar como enviado ao DP</button>
          </div>
        </div>

        <div className="schedule-overview-grid mt-5">
          <div className="schedule-overview-card">
            <span>Beneficiários</span>
            <strong>{beneficiaries.length}</strong>
            <small>pessoas com vale-transporte no período</small>
          </div>
          <div className="schedule-overview-card">
            <span>Dias presenciais</span>
            <strong>{totalPresenceDays}</strong>
            <small>soma dos deslocamentos previstos</small>
          </div>
          <div className="schedule-overview-card">
            <span>Período</span>
            <strong>{MONTHS[month - 1]} {year}</strong>
            <small>calculado a partir da escala atual</small>
          </div>
          <div className={`schedule-overview-card ${deadlineTone}`}>
            <span>Prazo mensal</span>
            <strong>{deadlineTitle}</strong>
            <small>{deadlineDetail}</small>
          </div>
        </div>
      </section>

      <section className="schedule-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="schedule-kicker">Resumo para envio</p>
            <h3 className="schedule-heading mt-1 text-lg font-bold">Dias presenciais por beneficiário</h3>
            <p className="schedule-subtitle mt-1 text-sm">Este é o quadro que deve ser conferido antes do envio ao DP.</p>
          </div>
          {submission?.status === 'SENT' && <span className="schedule-transport-sent">✓ Envio registrado</span>}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="schedule-transport-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Time no período</th>
                <th>Vigência do benefício</th>
                <th className="text-center">Dias presenciais</th>
                <th>Situação do cálculo</th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((item) => (
                <tr key={item.person.id}>
                  <td><strong>{item.person.name}</strong></td>
                  <td>{item.team}</td>
                  <td>
                    {formatDate(item.benefit.start_date)}
                    {item.benefit.end_date ? ` até ${formatDate(item.benefit.end_date)}` : ' em diante'}
                  </td>
                  <td className="text-center"><span className="schedule-transport-days">{item.days}</span></td>
                  <td>
                    {item.hasSchedule
                      ? <span className="schedule-transport-ready">Escala calculada</span>
                      : <span className="schedule-transport-pending">Gerar/conferir escala</span>}
                  </td>
                </tr>
              ))}
              {!beneficiaries.length && (
                <tr><td colSpan={5} className="schedule-empty">Nenhum beneficiário de vale-transporte configurado para este mês.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="schedule-card p-5">
        <div>
          <p className="schedule-kicker">Cadastro</p>
          <h3 className="schedule-heading mt-1 text-lg font-bold">Quem recebe vale-transporte?</h3>
          <p className="schedule-subtitle mt-1 text-sm">
            Ative ou desative o benefício pelo mês. O histórico anterior é preservado para conferências futuras.
          </p>
        </div>

        <div className="schedule-transport-benefit-grid mt-4">
          {activePeople.map((person) => {
            const current = benefitForMonth(person.id)
            return (
              <button
                type="button"
                key={person.id}
                className={`schedule-transport-person ${current ? 'is-active' : ''}`}
                onClick={() => toggleBenefit(person)}
              >
                <span className="schedule-transport-toggle" aria-hidden="true">
                  <span />
                </span>
                <span className="min-w-0 text-left">
                  <strong>{person.name}</strong>
                  <small>{teamNamesForMonth(person.id)}</small>
                </span>
                <span className="schedule-transport-person-status">{current ? 'Recebe VT' : 'Não recebe'}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="schedule-inline-note">
        <strong>Critério usado no cálculo:</strong> o relatório conta somente dias em que a escala híbrida estiver como
        <strong> Presencial</strong> ou <strong>Click Day</strong>. Home Office, feriados, férias, folgas, premiações e demais
        ausências não entram na quantidade de dias de vale-transporte.
      </div>
    </div>
  )
}

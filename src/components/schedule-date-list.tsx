'use client'

import { useMemo, useState } from 'react'

type Props = {
  label: string
  help?: string
  value: string[]
  onChange: (value: string[]) => void
  accent?: 'neutral' | 'amber' | 'violet'
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

export function ScheduleDateList({
  label,
  help,
  value,
  onChange,
  accent = 'neutral',
}: Props) {
  const [draft, setDraft] = useState('')

  const sorted = useMemo(
    () => [...new Set(value.filter(Boolean))].sort(),
    [value],
  )

  function add() {
    if (!draft || sorted.includes(draft)) return
    onChange([...sorted, draft].sort())
    setDraft('')
  }

  function remove(date: string) {
    onChange(sorted.filter((item) => item !== date))
  }

  return (
    <div className={`schedule-date-list schedule-date-list-${accent}`}>
      <div>
        <p className="schedule-field-title">{label}</p>
        {help ? <p className="schedule-field-help">{help}</p> : null}
      </div>

      <div className="schedule-date-add">
        <input
          type="date"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          aria-label={`Adicionar data em ${label}`}
        />
        <button type="button" className="small-button" onClick={add} disabled={!draft}>
          Adicionar
        </button>
      </div>

      <div className="schedule-date-chips">
        {sorted.map((date) => (
          <span key={date} className="schedule-date-chip">
            {formatDate(date)}
            <button
              type="button"
              onClick={() => remove(date)}
              aria-label={`Remover ${formatDate(date)} de ${label}`}
            >
              ×
            </button>
          </span>
        ))}
        {!sorted.length ? <span className="schedule-date-empty">Nenhuma data informada</span> : null}
      </div>
    </div>
  )
}

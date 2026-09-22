'use client'

import type { ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  tone?: 'default' | 'danger'
}

export function ScheduleModal({
  title,
  description,
  children,
  onClose,
  footer,
  tone = 'default',
}: Props) {
  return (
    <div
      className="schedule-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className={`schedule-modal ${tone === 'danger' ? 'schedule-modal-danger' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="schedule-modal-header">
          <div>
            <p className="schedule-kicker">Painel de Escalas</p>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="schedule-modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="schedule-modal-body">{children}</div>
        {footer ? <footer className="schedule-modal-footer">{footer}</footer> : null}
      </section>
    </div>
  )
}

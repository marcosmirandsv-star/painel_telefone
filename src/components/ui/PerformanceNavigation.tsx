'use client'

import type { ReactNode } from 'react'
import { PerformanceIcon, type PerformanceIconName } from './performance-icons'

export type PerformanceNavItem = {
  id: string
  label: string
  description: string
  icon: PerformanceIconName
  href?: string
}

export type PerformanceNavGroup = { label: string; items: PerformanceNavItem[] }

export function PerformanceNavigation({
  groups, label, activeId, onSelect, subtitle,
}: {
  groups: PerformanceNavGroup[]
  label: string
  activeId?: string
  subtitle?: string
  onSelect?: (id: string) => void
}) {
  return <aside className="pnav-sidebar">
    <div className="pnav-sidebar-title">
      <span className="pnav-sidebar-logo"><PerformanceIcon name="layers" size={20}/></span>
      <div>
        <strong>{label}</strong>
        <small>{subtitle ?? 'Selecione uma área'}</small>
      </div>
    </div>
    <nav className="pnav-menu" aria-label={label}>
      {groups.map(group => <div key={group.label} className="pnav-group">
        <h2 className="pnav-group-title">{group.label}</h2>
        <div className="pnav-group-items">
          {group.items.map(item => {
            const selected = activeId === item.id
            const contents = <>
              <span className="pnav-item-icon"><PerformanceIcon name={item.icon}/></span>
              <span className="pnav-item-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
              <span className="pnav-item-arrow"><PerformanceIcon name="chevron" size={14}/></span>
            </>
            const className = 'pnav-item'+(selected?' pnav-item-active':'')
            return item.href ? <a key={item.id} className={className} href={item.href}
              aria-current={selected ? 'location' : undefined}
              title={item.description}>{contents}</a>
              : <button type="button" key={item.id} className={className}
                onClick={() => onSelect?.(item.id)} aria-current={selected ? 'page' : undefined}
                title={item.description}>{contents}</button>
          })}
        </div>
      </div>)}
    </nav>
    <div className="pnav-sidebar-foot"><PerformanceIcon name="shield" size={16}/>
      <span>Os dados exibidos respeitam as permissões do seu perfil.</span>
    </div>
  </aside>
}

export type PerformancePageHelp = {
  category: string
  title: string
  summary: string
  howTo: string[]
  fields: { label: string; meaning: string }[]
  caution?: string
}

export function PerformancePageGuide({
  help,
  compact = false,
  children,
}: {
  help: PerformancePageHelp
  compact?: boolean
  children?: ReactNode
}) {
  return <section className={'pnav-page-guide'+(compact?' pnav-page-guide-compact':'')} aria-label={'Sobre '+help.title}>
    <div className="pnav-page-guide-header">
      <span className="pnav-guide-icon"><PerformanceIcon name="info" size={19}/></span>
      <div className="pnav-guide-title-group">
        <span className="pnav-guide-kicker">{help.category}</span>
        <h2>{help.title}</h2>
        <p>{help.summary}</p>
      </div>
      {children}
    </div>
    <details className="pnav-guide-more">
      <summary>Como usar esta tela e entender os campos <PerformanceIcon name="chevron" size={15}/></summary>
      <div className="pnav-guide-detail-columns">
        <div>
          <h3>Como usar</h3>
          <ol>{help.howTo.map(step => <li key={step}>{step}</li>)}</ol>
        </div>
        <div>
          <h3>O que significam os campos</h3>
          <dl>{help.fields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.meaning}</dd></div>)}</dl>
        </div>
      </div>
      {help.caution && <p className="pnav-guide-caution"><PerformanceIcon name="info" size={15}/>{help.caution}</p>}
    </details>
  </section>
}

import type { ReactNode, SVGProps } from 'react'

export type PerformanceIconName =
  | 'activity' | 'users' | 'scan' | 'clipboard' | 'trophy' | 'file'
  | 'history' | 'settings' | 'headphones' | 'calendar' | 'shield'
  | 'chart' | 'message' | 'layers' | 'target' | 'list'
  | 'info' | 'chevron' | 'home' | 'check'

const paths: Record<PerformanceIconName, ReactNode> = {
  activity: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  scan: <><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="3"/><path d="m14.4 14.4 2.1 2.1"/></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></>,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H3v2a4 4 0 0 0 4 4M17 6h4v2a4 4 0 0 1-4 4"/></>,
  file: <><path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v6h5M8 13h8M8 17h8"/></>,
  history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .2 2.2-2.4 2.4-2.2-.2-.9 1.6h-3.4l-.9-1.6-2.2.2-2.4-2.4.2-2.2L3.8 14v-3.4l1.6-.9-.2-2.2 2.4-2.4 2.2.2.9-1.6h3.4l.9 1.6 2.2-.2 2.4 2.4-.2 2.2 1.6.9V14Z"/></>,
  headphones: <><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 17h3"/></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  chart: <><path d="M3 3v18h18M7 17v-4M12 17V8M17 17V5"/></>,
  message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A9 9 0 0 1 12 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 12a9 9 0 0 1 4.7-8.1 8.4 8.4 0 0 1 3.8-.9H13a9 9 0 0 1 8 8v.5Z"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12"/><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7h.01"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-7h6v7"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
}

export function PerformanceIcon({
  name,
  size = 19,
  ...props
}: SVGProps<SVGSVGElement> & { name: PerformanceIconName; size?: number }) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false" {...props}>
    {paths[name]}
  </svg>
}

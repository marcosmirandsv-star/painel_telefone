'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

type PendingInvitation = {
  analyst_id: string
  name: string
  email: string
  active: boolean
  status: 'pending' | 'sending' | 'invited' | 'failed' | 'link_failed'
  invited_at: string | null
  last_error: string | null
}

export default function ChatAccessManagement({ analysts }: { analysts: { id: string; name: string; active: boolean }[] }) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [inviteLoading, setInviteLoading] = useState(true)
  const [inviteBusy, setInviteBusy] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  async function inviteHeaders() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sua sessão expirou. Entre novamente como gestor.')
    return { Authorization: 'Bearer ' + session.access_token }
  }
  async function loadInvitations() {
    setInviteLoading(true)
    try {
      const headers = await inviteHeaders()
      const response = await fetch('/api/chat-production/invitations', { headers, cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.erro || 'Convites indisponíveis.')
      setInvitations(result.items ?? [])
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Convites indisponíveis.')
    } finally {
      setInviteLoading(false)
    }
  }
  useEffect(() => { void loadInvitations() }, [])

  async function sendInvitation(analystId: string): Promise<boolean> {
    setInviteBusy(analystId)
    setInviteMessage('')
    try {
      const auth = await inviteHeaders()
      const response = await fetch('/api/chat-production/invitations', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ analystId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.erro || 'Convite não criado.')
      await loadInvitations()
      setInviteMessage(result.message || 'Convite registrado.')
      return true
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Falha ao enviar convite.')
      await loadInvitations()
      return false
    } finally {
      setInviteBusy('')
    }
  }
  async function sendPendingInvitations() {
    const eligible = invitations.filter(i => i.active && ['pending','failed','link_failed'].includes(i.status))
    if (!eligible.length) return
    if (!window.confirm('Enviar convites aos ' + eligible.length + ' analistas pendentes? Cada destinatário poderá definir sua própria senha.')) return
    setInviteBusy('batch')
    let sent = 0
    for (const item of eligible) {
      const ok = await sendInvitation(item.analyst_id)
      if (!ok) {
        setInviteMessage('Envio interrompido após ' + sent + ' convite(s). Verifique a falha antes de continuar.')
        break
      }
      sent++
    }
    await loadInvitations()
    setInviteBusy('')
    if (sent === eligible.length) setInviteMessage(sent + ' convites processados. Confira o recebimento com os analistas.')
  }
  const invitationLabel: Record<PendingInvitation['status'], string> = {
    pending: 'Pronto para envio', sending: 'Em processamento',
    invited: 'Convite registrado', failed: 'Falha no envio',
    link_failed: 'Vínculo pendente',
  }
  const [analystId, setAnalystId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function create(event: FormEvent) {
    event.preventDefault()
    const analyst = analysts.find(item => item.id === analystId && item.active)
    if (!analyst) return
    setBusy(true); setMessage('Criando o acesso individual...')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Entre novamente com sua conta de gestão.')
      const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ fullName: analyst.name, email, password, role: 'analista', chatAnalystId: analyst.id }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Não foi possível criar o acesso.')
      setPassword(''); setEmail(''); setAnalystId(''); setMessage('Acesso criado. O analista poderá entrar no endereço da Central com o e-mail e a senha definidos. Nenhum e-mail foi enviado.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Acesso não criado.') }
    finally { setBusy(false) }
  }
  return <section className="panel space-y-4" aria-label="Acessos individuais do Chat">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">Convites individuais do Chat</h2>
        <p className="mt-1 text-sm text-slate-400">E-mails conferidos pela gestão. Cada analista define a própria senha pelo convite. Não são criados acessos de forma automática.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="secondary-button" disabled={inviteLoading || !!inviteBusy} onClick={() => void loadInvitations()}>Atualizar</button>
        <button type="button" className="primary-button" disabled={inviteLoading || !!inviteBusy || !invitations.some(i => i.active && ['pending','failed','link_failed'].includes(i.status))}
          onClick={() => void sendPendingInvitations()}>{inviteBusy ? 'Processando...' : 'Enviar convites pendentes'}</button>
      </div>
    </div>
    {inviteMessage && <p role="status" className="text-sm text-cyan-200">{inviteMessage}</p>}
    {inviteLoading ? <p className="text-sm text-slate-400">Consultando convites...</p> : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] text-left text-sm">
          <thead className="text-slate-400"><tr><th className="p-2">Analista</th><th className="p-2">E-mail corporativo</th><th className="p-2">Situação</th><th className="p-2">Ação</th></tr></thead>
          <tbody className="divide-y divide-white/10">
            {invitations.map(item => <tr key={item.analyst_id}>
              <td className="p-2">{item.name}</td>
              <td className="p-2">{item.email}</td>
              <td className="p-2">{invitationLabel[item.status]}{item.last_error && <p className="mt-1 text-xs text-amber-200">{item.last_error}</p>}</td>
              <td className="p-2"><button type="button" className="small-button" disabled={!!inviteBusy || !item.active || !['pending','failed','link_failed'].includes(item.status)}
                onClick={() => void sendInvitation(item.analyst_id)}>{item.status === 'link_failed' ? 'Concluir vínculo' : 'Enviar convite'}</button></td>
            </tr>)}
          </tbody>
        </table>
        {!invitations.length && <p className="p-3 text-sm text-slate-400">Nenhum convite preparado.</p>}
      </div>
    )}
    <details className="rounded-lg border border-white/10 p-4">
      <summary className="cursor-pointer font-semibold">Criar acesso manual com senha inicial (modo anterior)</summary>

    <h2 className="text-xl font-bold">Criar acesso individual do Chat</h2>
    <p className="text-sm text-slate-400">Selecione o analista e informe o e-mail corporativo e a senha inicial. Esse acesso permite consultar somente o próprio desempenho.</p>
    <form onSubmit={create}><fieldset disabled={busy} className="grid gap-4 md:grid-cols-3">
      <label>Analista<select required value={analystId} onChange={event => setAnalystId(event.target.value)} className="input mt-1 w-full"><option value="">Selecione</option>{analysts.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>E-mail corporativo<input className="input mt-1 w-full" required type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)}/></label>
      <label>Senha inicial<input className="input mt-1 w-full" required type="password" minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
      <button className="primary-button" type="submit">{busy ? 'Criando...' : 'Criar acesso do Chat'}</button>
    </fieldset></form>
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
    </details>
  </section>
}

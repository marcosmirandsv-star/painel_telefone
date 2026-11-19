'use client'

import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

export default function ChatAccessManagement({ analysts }: { analysts: { id: string; name: string; active: boolean }[] }) {
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
    <h2 className="text-xl font-bold">Criar acesso individual do Chat</h2>
    <p className="text-sm text-slate-400">Selecione o analista e informe o e-mail corporativo e a senha inicial. Esse acesso permite consultar somente o próprio desempenho.</p>
    <form onSubmit={create}><fieldset disabled={busy} className="grid gap-4 md:grid-cols-3">
      <label>Analista<select required value={analystId} onChange={event => setAnalystId(event.target.value)} className="input mt-1 w-full"><option value="">Selecione</option>{analysts.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>E-mail corporativo<input className="input mt-1 w-full" required type="email" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)}/></label>
      <label>Senha inicial<input className="input mt-1 w-full" required type="password" minLength={8} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)}/></label>
      <button className="primary-button" type="submit">{busy ? 'Criando...' : 'Criar acesso do Chat'}</button>
    </fieldset></form>
    {message && <p role="status" className="text-sm text-cyan-200">{message}</p>}
  </section>
}

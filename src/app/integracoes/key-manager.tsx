'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

type KeyInfo = { id: string; name: string; prefix: string; channels: string[]; created_at: string; expires_at: string; revoked_at: string | null }
type KeyResponse = { keys?: KeyInfo[]; hasMore?: boolean; key?: KeyInfo; token?: string; erro?: string }
function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}
export default function KeyManager() {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [name, setName] = useState('')
  const [channels, setChannels] = useState<string[]>(['telefone', 'chat'])
  const [days, setDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [issued, setIssued] = useState<{ key: KeyInfo; token: string } | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const pending = useRef(false)
  const request = useCallback(async (method: string, body?: object, pageNumber = 1): Promise<KeyResponse> => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sua sessão expirou. Entre novamente no painel.')
    const response = await fetch(`/api/integrations/keys${method === 'GET' ? `?pagina=${pageNumber}` : ''}`, {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.erro || 'Não foi possível concluir a operação.')
    return result
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    request('GET').then(data => {
      if (active) { setKeys(data.keys ?? []); setHasMore(Boolean(data.hasMore)) }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Erro ao carregar as chaves.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [request])
  useEffect(() => {
    if (!issued) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [issued])
  async function load(nextPage = 1) {
    if (pending.current) return
    pending.current = true; setLoading(true); setMessage('')
    try {
      const data = await request('GET', undefined, nextPage)
      setKeys(previous => nextPage === 1 ? data.keys ?? [] : [...previous, ...(data.keys ?? [])].filter((key, index, all) => all.findIndex(item => item.id === key.id) === index))
      setPage(nextPage); setHasMore(Boolean(data.hasMore))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao carregar as chaves.') }
    finally { pending.current = false; setLoading(false) }
  }
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || issued) return
    pending.current = true; setBusy(true); setMessage('')
    try {
      const data = await request('POST', { name, channels, validity_days: days })
      if (!data.key || !data.token) throw new Error('Resposta incompleta. Atualize a lista antes de tentar novamente.')
      setIssued({ key: data.key, token: data.token })
      setKeys(previous => [data.key!, ...previous]); setName('')
      setMessage('Chave gerada. Copie e entregue somente ao responsável pelo sistema informado.')
    } catch (error) { setMessage(`${error instanceof Error ? error.message : 'Falha ao gerar chave.'} Se houver dúvida, atualize a lista e revogue a chave não utilizada antes de gerar outra.`) }
    finally { pending.current = false; setBusy(false) }
  }
  async function revoke(key: KeyInfo) {
    if (pending.current) return
    pending.current = true; setBusy(true); setMessage('')
    try {
      const data = await request('PATCH', { id: key.id })
      if (!data.key) throw new Error('Resposta incompleta. Atualize a lista para conferir.')
      setKeys(previous => previous.map(item => item.id === key.id ? data.key! : item))
      if (issued?.key.id === key.id) setIssued(null)
      setRevokeId(null); setMessage(`Acesso de “${key.name}” revogado. Novas consultas com essa chave serão bloqueadas.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Erro ao revogar chave.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function copy(instructions = false) {
    if (!issued) return
    const text = instructions ? [
      `Acesso à Central de Performance - ${issued.key.name}`,
      `Endereço: ${window.location.origin}`,
      `Chave: ${issued.token}`,
      `Canais: ${issued.key.channels.join(', ')}`,
      `Validade: ${formatDate(issued.key.expires_at)} (Brasília)`,
      'Enviar a chave no cabeçalho Authorization: Bearer <chave>.',
      `Consulta: GET /api/v1/indicadores/mensais?mes=AAAA-MM&canal=${issued.key.channels[0]}&fonte=atual`,
      'Use um canal autorizado. Para fechamento aprovado, use fonte=oficial.',
      'Acesso somente para leitura de indicadores. Guarde a chave como segredo no servidor.',
    ].join('\n') : issued.token
    try { await navigator.clipboard.writeText(text); setMessage(instructions ? 'Instruções copiadas. Entregue ao responsável autorizado.' : 'Chave copiada.') }
    catch { setMessage('Não foi possível copiar automaticamente. Selecione a chave no campo abaixo e copie manualmente.') }
  }
  return <section className="mt-5 space-y-5" aria-labelledby="key-manager-title">
    <div>
      <h2 id="key-manager-title" className="text-lg font-semibold text-white">Chaves de acesso</h2>
      <p className="mt-2">Gere uma chave para cada sistema da empresa. Ela libera apenas a consulta de indicadores dos canais selecionados, incluindo dados atuais e fechamentos já aprovados.</p>
    </div>
    <p role="status" aria-live="polite" className="text-cyan-200">{message}</p>
    {issued ? <div className="space-y-3 rounded-lg border border-cyan-700 bg-cyan-950/30 p-4">
      <h3 className="font-semibold text-white">Chave de {issued.key.name}</h3>
      <p>A chave completa aparece somente agora. Copie antes de sair. Se perder, revogue este acesso e gere outra chave.</p>
      <label className="block">Chave gerada
        <input readOnly value={issued.token} autoComplete="off" spellCheck={false} onFocus={e => e.target.select()} className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3 font-mono text-sm text-white" />
      </label>
      <p>Válida até {formatDate(issued.key.expires_at)} (Brasília).</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="primary-button" onClick={() => copy()}>Copiar chave</button>
        <button type="button" className="secondary-button" onClick={() => copy(true)}>Copiar instruções de acesso</button>
        <button type="button" className="secondary-button" onClick={() => { setIssued(null); setMessage('A chave foi ocultada. Você pode acompanhar ou revogar o acesso na lista abaixo.') }}>Já copiei, concluir</button>
      </div>
    </div> : <form onSubmit={generate} className="rounded-lg border border-slate-700 p-4">
      <fieldset disabled={busy || loading} className="space-y-4">
        <legend className="font-semibold text-white">Gerar uma nova chave</legend>
        <label className="block">Sistema ou setor que receberá o acesso
          <input required minLength={3} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Plataforma de Projetos" className="mt-2 w-full rounded border border-slate-600 bg-slate-900 p-3 text-white" />
        </label>
        <fieldset className="flex flex-wrap gap-5">
          <legend className="mb-2">Canais que poderão ser consultados</legend>
          {['telefone', 'chat'].map(channel => <label key={channel} className="flex items-center gap-2">
            <input type="checkbox" checked={channels.includes(channel)} onChange={e => setChannels(previous => e.target.checked ? [...previous, channel] : previous.filter(c => c !== channel))} />
            {channel === 'telefone' ? 'Telefone' : 'Chat'}
          </label>)}
        </fieldset>
        <label className="block">Validade
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="ml-3 rounded border border-slate-600 bg-slate-900 p-2 text-white">
            {[30, 90, 180, 365].map(value => <option key={value} value={value}>{value} dias</option>)}
          </select>
        </label>
        <p>A chave não permite alterar dados, aprovar fechamentos nem criar outros acessos. Ela autoriza todas as equipes dos canais escolhidos.</p>
        <button type="submit" disabled={!channels.length || name.trim().length < 3 || busy || loading} className="primary-button disabled:opacity-50">{busy ? 'Gerando…' : 'Gerar chave'}</button>
      </fieldset>
    </form>}
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-white">Chaves criadas pelo painel</h3>
        <button type="button" disabled={busy || loading} className="secondary-button disabled:opacity-50" onClick={() => load()}>Atualizar lista</button>
      </div>
      {loading && <p>Carregando chaves…</p>}
      {!loading && !keys.length && <p>Nenhuma chave criada pelo painel foi encontrada.</p>}
      {keys.map(key => {
        const status = key.revoked_at ? 'Revogada' : Date.parse(key.expires_at) <= now ? 'Expirada' : 'Ativa'
        return <article key={key.id} className="space-y-2 rounded-lg border border-slate-700 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-white">{key.name}</h4><span>{status}</span></div>
          <p>{key.channels.map(c => c === 'telefone' ? 'Telefone' : 'Chat').join(' e ')} · Validade: {formatDate(key.expires_at)} (Brasília)</p>
          <p className="text-xs text-slate-400">Identificação: {key.prefix}… · Criada em {formatDate(key.created_at)}</p>
          {key.revoked_at && <p>Revogada em {formatDate(key.revoked_at)}.</p>}
          {!key.revoked_at && (revokeId === key.id ? <div className="space-y-2">
            <p>Revogar o acesso de “{key.name}”? Novas consultas serão bloqueadas. Essa ação não pode ser desfeita; será necessário gerar outra chave.</p>
            <div className="flex gap-2"><button type="button" disabled={busy || loading} className="danger-button" onClick={() => revoke(key)}>Confirmar revogação</button><button type="button" disabled={busy} className="secondary-button" onClick={() => setRevokeId(null)}>Cancelar</button></div>
          </div> : <button type="button" disabled={busy || loading} className="danger-button" onClick={() => setRevokeId(key.id)}>Revogar acesso</button>)}
        </article>
      })}
      {hasMore && <button type="button" disabled={busy || loading} className="secondary-button" onClick={() => load(page + 1)}>Carregar mais chaves</button>}
    </div>
  </section>
}

'use client'

import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

type Goal = {
  id: string
  label: string
  value: number
  unit: string
}

type Analyst = {
  id: string
  name: string
  active: boolean
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])
  const [analysts, setAnalysts] = useState<Analyst[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function loadSession() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      setLoading(false)
    }

    loadSession()
  }, [])

  useEffect(() => {
    if (!user) return

    async function loadData() {
      setLoading(true)

      const [goalsResult, analystsResult] = await Promise.all([
        supabase.from('goals').select('id, label, value, unit').order('label'),
        supabase.from('analysts').select('id, name, active').order('name'),
      ])

      if (goalsResult.error) {
        setMessage(goalsResult.error.message)
      } else {
        setGoals(goalsResult.data ?? [])
      }

      if (analystsResult.error) {
        setMessage(analystsResult.error.message)
      } else {
        setAnalysts(analystsResult.data ?? [])
      }

      setLoading(false)
    }

    loadData()
  }, [user])

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('Entrando...')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setUser(data.user)
    setMessage('')
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    setGoals([])
    setAnalysts([])
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <section className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 p-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
            Painel Telefone
          </p>

          <h1 className="mt-4 text-3xl font-bold">
            Entrar no sistema
          </h1>

          <form className="mt-6 space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="text-sm text-slate-300">E-mail</label>
              <input
                className="mt-2 w-full rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-sm text-slate-300">Senha</label>
              <input
                className="mt-2 w-full rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-white outline-none focus:border-cyan-300"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

            <button
              className="w-full rounded-md bg-cyan-300 px-4 py-3 font-semibold text-slate-950"
              type="submit"
            >
              Entrar
            </button>
          </form>

          {message && (
            <p className="mt-4 rounded-md bg-slate-900 p-3 text-sm text-slate-300">
              {message}
            </p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <section className="mx-auto max-w-6xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">
              Painel Telefone
            </p>

            <h1 className="mt-4 text-4xl font-bold">
              Gestao de Performance de Atendimento
            </h1>

            <p className="mt-3 max-w-3xl text-slate-300">
              Primeira versao conectada ao Supabase. Aqui vamos acompanhar analistas,
              metas, lancamentos semanais, performance da equipe e relatorios com IA.
            </p>
          </div>

          <button
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-300"
            onClick={handleLogout}
          >
            Sair
          </button>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Status</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-300">
              Supabase conectado
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Analistas ativos</p>
            <p className="mt-2 text-2xl font-semibold">
              {loading ? 'Carregando...' : analysts.length}
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/5 p-5">
            <p className="text-sm text-slate-400">Metas configuradas</p>
            <p className="mt-2 text-2xl font-semibold">
              {loading ? 'Carregando...' : goals.length}
            </p>
          </div>
        </div>

        {message && (
          <p className="mt-6 rounded-md bg-slate-900 p-3 text-sm text-slate-300">
            {message}
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Analistas</h2>

            <div className="mt-4 space-y-3">
              {analysts.map((analyst) => (
                <div key={analyst.id} className="flex items-center justify-between rounded-md bg-slate-900 px-4 py-3">
                  <span>{analyst.name}</span>
                  <span className="text-sm text-emerald-300">Ativo</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-5">
            <h2 className="text-xl font-semibold">Metas</h2>

            <div className="mt-4 space-y-3">
              {goals.map((goal) => (
                <div key={goal.id} className="flex items-center justify-between rounded-md bg-slate-900 px-4 py-3">
                  <span>{goal.label}</span>
                  <strong>
                    {goal.value}
                    {goal.unit === 'percent' ? '%' : ''}
                  </strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}

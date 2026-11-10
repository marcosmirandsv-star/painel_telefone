import { ApiError, handle, json } from '@/lib/integration-server'
import { authorizeCx, cxBody } from '@/lib/cx360-server'
import { caseStates, isUuid, validateCaseUpdate, type CxCase } from '@/lib/cx360'
import { configured } from '@/lib/cx360-diagnostics-server'

export const runtime = 'nodejs'
export async function GET(request: Request) {
  return handle(async () => {
    const { client, userId } = await authorizeCx(request)
    const params = new URL(request.url).searchParams
    for (const key of params.keys()) if (!['team_id', 'status'].includes(key) || params.getAll(key).length !== 1) throw new ApiError(400, 'Filtro inválido.')
    const team = params.get('team_id'), status = params.get('status')
    if (team && !isUuid(team)) throw new ApiError(400, 'Equipe inválida.')
    if (status && !caseStates.includes(status as CxCase['status'])) throw new ApiError(400, 'Etapa inválida.')
    let query = client.from('cx360_cases').select('*').order('updated_at', { ascending: false }).limit(201)
    if (team) query = query.eq('team_id', team)
    if (status) query = query.eq('status', status)
    const [cases, teams, managers, sources] = await Promise.all([
      query,
      client.from('chat_teams').select('id,name').order('name'),
      client.from('profiles').select('id,full_name,role').in('role', ['master', 'coordenadora']).order('full_name'),
      client.from('cx360_sources').select('team_id,display_name'),
    ])
    if (cases.error || teams.error || managers.error || sources.error) throw new ApiError(503, 'Não foi possível carregar a área de gestão.')
    return json({ environment: 'producao', user_id: userId, cases: (cases.data ?? []).slice(0, 200), truncated: (cases.data ?? []).length > 200,
      teams: (teams.data??[]).map(team=>({...team,name:sources.data?.find(s=>s.team_id===team.id)?.display_name??team.name})), managers: managers.data, retrieved_at: new Date().toISOString(),
      diagnostics: { available: configured(), note: configured()?'ClickDesk de produção integrado à análise dos atendimentos. Cobertura e pendências aparecem na aba Análise dos atendimentos; resultados até D-1.':'Integração ClickDesk aguardando configuração segura no servidor. Registros manuais continuam disponíveis.' } })
  })
}
export async function POST(request: Request) {
  return handle(async () => {
    const { client, userId } = await authorizeCx(request)
    const body = await cxBody(request)
    const value = (key: string, min: number, max: number) => {
      if (typeof body[key] !== 'string' || (body[key] as string).trim().length < min || (body[key] as string).length > max) throw new ApiError(400, `Preencha corretamente o campo ${key}.`)
      return (body[key] as string).trim()
    }
    if (!isUuid(body.team_id) || !['clickdesk', 'zendesk', 'telefone'].includes(String(body.ticket_source))) throw new ApiError(400, 'Equipe ou origem inválida.')
    const result = await client.from('cx360_cases').insert({ title: value('title', 5, 200), team_id: body.team_id,
      ticket_source: body.ticket_source, ticket_id: value('ticket_id', 1, 100), observation: value('observation', 10, 3000),
      evidence: value('evidence', 10, 3000), hypothesis: value('hypothesis', 0, 3000), impact: value('impact', 0, 3000), owner_id: userId,
    }).select().single()
    if (result.error) throw new ApiError(result.error.code === '23505' ? 409 : 422, result.error.code === '23505' ? 'Esta evidência já tem um acompanhamento para a mesma equipe.' : 'Não foi possível registrar a ocorrência. Confira os campos.')
    return json({ case: result.data }, 201)
  })
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const { client } = await authorizeCx(request)
    const body = await cxBody(request)
    if (!isUuid(body.id) || !Number.isInteger(body.version)) throw new ApiError(400, 'Registro ou versão inválida.')
    const previous = await client.from('cx360_cases').select('*').eq('id', body.id).maybeSingle()
    if (previous.error) throw new ApiError(503, 'Consulta indisponível.')
    if (!previous.data) throw new ApiError(404, 'Acompanhamento não encontrado.')
    let update
    try { update = validateCaseUpdate(previous.data as CxCase, body) } catch (error) { throw new ApiError(400, (error as Error).message) }
    const result = await client.from('cx360_cases').update({ ...update, approval_requested: body.approve === true }).eq('id', body.id).eq('version', body.version).select().maybeSingle()
    if (result.error) throw new ApiError(422, 'Alteração recusada. Confira a etapa, a aprovação e o responsável.')
    if (!result.data) throw new ApiError(409, 'Outra pessoa alterou este acompanhamento. Consulte novamente antes de salvar.')
    return json({ case: result.data })
  })
}

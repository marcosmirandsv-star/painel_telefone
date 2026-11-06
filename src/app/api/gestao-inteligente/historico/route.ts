import { ApiError, handle, json } from '@/lib/integration-server'
import { authorizeCx } from '@/lib/cx360-server'
import { isUuid } from '@/lib/cx360'
export async function GET(request: Request) {
  return handle(async () => {
    const { client } = await authorizeCx(request)
    const id = new URL(request.url).searchParams.get('id')
    if (!isUuid(id)) throw new ApiError(400, 'Registro inválido.')
    const result = await client.from('cx360_events').select('id,actor_id,occurred_at,before_state,after_state').eq('case_id', id).order('occurred_at').limit(501)
    if (result.error) throw new ApiError(503, 'Histórico indisponível.')
    return json({ events: (result.data ?? []).slice(0, 500), truncated: (result.data ?? []).length > 500 })
  })
}

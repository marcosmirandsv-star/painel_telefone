import { authorizeConsumer, handle, json, parseQuery } from '@/lib/integration-server'
import { currentIndicators, officialIndicators } from '@/lib/integration-data'
export const runtime = 'nodejs'
export async function GET(request: Request) {
  return handle(async () => {
    const period = parseQuery(request)
    const admin = await authorizeConsumer(request, period.channel)
    return json(await (period.source === 'oficial' ? officialIndicators(admin, period) : currentIndicators(admin, period)))
  })
}

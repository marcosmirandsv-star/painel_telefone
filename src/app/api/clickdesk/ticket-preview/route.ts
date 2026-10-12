import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { extractTranscriptText } from '@/lib/clickdesk-qualitative'
import { extractRestRecords } from '@/lib/clickdesk-rest-evidence'

export const runtime = 'nodejs'

// Read-only ticket preview. No mutation to ClickDesk, Supabase or qualitative AI state.
export async function GET(request: Request) {
  return handle(async () => {
    if (getServerSupabaseConfig().environment !== 'homologacao') {
      throw new ApiError(404, 'Consulta disponível somente na homologação.')
    }
    const params = new URL(request.url).searchParams
    if ([...params.keys()].some((key) => key !== 'ticket_id') || params.getAll('ticket_id').length !== 1) {
      throw new ApiError(400, 'Informe apenas ticket_id.')
    }
    const ticketId = params.get('ticket_id') ?? ''
    if (!/^[0-9]{1,18}$/.test(ticketId)) {
      throw new ApiError(400, 'ID de ticket inválido.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    let ownership = access.admin
      .from('clickdesk_chat_verified_contributions')
      .select('ticket_id,analyst_id,analyst_name,first_answered_at,first_message_id,satisfaction_label')
      .eq('ticket_id', ticketId)
    if (!access.isManagement) {
      if (!access.chatAnalystId) throw new ApiError(403, 'Acesso individual não vinculado.')
      ownership = ownership.eq('analyst_id', access.chatAnalystId)
    }
    const evidence = await ownership.limit(1).maybeSingle()
    if (evidence.error) throw new ApiError(503, 'Não foi possível confirmar a autoria.')
    if (!evidence.data) throw new ApiError(404, 'Ticket não encontrado na captura verificada ou fora do seu acesso.')

    const apiKey = process.env.CLICKDESK_API_KEY?.trim()
    const accountId = process.env.CLICKDESK_ACCOUNT_ID?.trim()
    let transcript: string | null = null
    let transcriptStatus: 'available' | 'unavailable' = 'unavailable'
    let transcriptSource: 'messages' | 'transcript' | null = null
    let diagnostic: string = !apiKey || !accountId
      ? 'missing_server_credentials'
      : 'not_loaded'

    if (apiKey && accountId) {
      // The same read-only /tickets/{id}/messages route used by the
      // historical verification is checked before the legacy /transcript
      // route. No ticket mutation, AI request or database update.
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        'X-Account-Id': accountId,
        Accept: 'application/json',
      }
      for (const source of ['messages', 'transcript'] as const) {
        if (transcriptStatus === 'available') break
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 12000)
        try {
          const response = await fetch(
            `https://api.desk.click.app/api/v1/tickets/${ticketId}/${source}`,
            { method: 'GET', headers, cache: 'no-store', signal: controller.signal },
          )
          if (!response.ok) {
            diagnostic = `${source}_http_${response.status}`
            continue
          }
          const payload: unknown = await response.json()
          if (source === 'messages') {
            const records = extractRestRecords(payload)
            transcript = extractTranscriptText(records).slice(0, 20000) || null
            diagnostic = records.length > 0 ? 'messages_no_readable_text' : 'messages_empty'
          } else {
            transcript = extractTranscriptText(payload).slice(0, 20000) || null
            diagnostic = 'transcript_no_readable_text'
          }
          if (transcript) {
            transcriptSource = source
            transcriptStatus = 'available'
            diagnostic = 'ok'
          }
        } catch (error) {
          diagnostic = error instanceof Error && error.name === 'AbortError'
            ? `${source}_timeout`
            : `${source}_unavailable`
        } finally {
          clearTimeout(timeout)
        }
      }
    }

    return json({
      source: 'clickdesk_verified_contributions',
      readonly: true,
      ticket_id: ticketId,
      analyst_name: evidence.data.analyst_name,
      first_answered_at: evidence.data.first_answered_at,
      first_message_id: evidence.data.first_message_id,
      satisfaction_label: evidence.data.satisfaction_label,
      transcript_status: transcriptStatus,
      transcript_source: transcriptSource,
      diagnostic,
      transcript,
      note: transcriptStatus === 'unavailable'
        ? diagnostic === 'missing_server_credentials'
          ? 'A visualização está sem credenciais de leitura do ClickDesk configuradas neste ambiente.'
          : 'A autoria está verificada, mas a API não disponibilizou o texto da conversa nesta consulta.'
        : 'Mensagens recuperadas para leitura. A completude do histórico depende da paginação da API ClickDesk, ainda não confirmada.',
    })
  })
}

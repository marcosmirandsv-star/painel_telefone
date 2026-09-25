import { createClient } from '@supabase/supabase-js'
import {
  ApiError,
  authorizeClickDeskSessionClient,
  handle,
  json,
} from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'
import { normalizeQualitativeAnalysis } from '@/lib/clickdesk-qualitative'

export const runtime = 'nodejs'

type ValidationRequest = {
  ticket_id?: string
  status?: 'approved' | 'rejected'
  notes?: string
}

function validTicketId(value: string) {
  return /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

export async function POST(request: Request) {
  return handle(async () => {
    const { environment, url, serviceRoleKey } = getServerSupabaseConfig()
    if (environment !== 'homologacao') {
      throw new ApiError(404, 'Validação qualitativa disponível somente na homologação.')
    }

    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) {
      throw new ApiError(403, 'Validação qualitativa disponível somente para a gestão.')
    }

    const body = (await request.json()) as ValidationRequest
    const ticketId = body.ticket_id?.trim() ?? ''
    const status = body.status

    if (!validTicketId(ticketId)) {
      throw new ApiError(400, 'ticket_id inválido.')
    }
    if (status !== 'approved' && status !== 'rejected') {
      throw new ApiError(400, 'status deve ser approved ou rejected.')
    }
    if (!serviceRoleKey) {
      throw new ApiError(503, 'Chave de serviço da homologação indisponível.')
    }

    const existing = await access.admin
      .from('clickdesk_qualitative_analyses')
      .select('clickdesk_ticket_id,analysis,validation_status')
      .eq('clickdesk_ticket_id', ticketId)
      .maybeSingle()

    if (existing.error) {
      throw new ApiError(503, 'Não foi possível validar a análise selecionada.')
    }
    if (!existing.data) {
      throw new ApiError(404, 'Análise qualitativa não encontrada.')
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const validatedAt = new Date().toISOString()
    const update = await admin
      .from('clickdesk_qualitative_analyses')
      .update({
        validation_status: status,
        validated_by: access.userId,
        validated_at: validatedAt,
        validation_notes: body.notes?.trim().slice(0, 1000) || null,
        updated_at: validatedAt,
      })
      .eq('clickdesk_ticket_id', ticketId)
      .select(
        'clickdesk_ticket_id,analyst_id,occurred_date,area,satisfaction_label,analysis,model,validation_status,validated_at,validation_notes',
      )
      .single()

    if (update.error || !update.data) {
      throw new ApiError(503, 'Não foi possível salvar a validação da análise.')
    }

    return json({
      source: 'clickdesk_qualitative_validation',
      ticket_id: update.data.clickdesk_ticket_id,
      analyst_id: update.data.analyst_id,
      occurred_date: update.data.occurred_date,
      area: update.data.area,
      satisfaction_label: update.data.satisfaction_label,
      model: update.data.model,
      validation_status: update.data.validation_status,
      validated_at: update.data.validated_at,
      validation_notes: update.data.validation_notes,
      analysis: normalizeQualitativeAnalysis(update.data.analysis),
    })
  })
}

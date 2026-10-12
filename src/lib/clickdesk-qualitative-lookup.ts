export type VerifiedQualitativeCandidate = {
  ticket_id: string
  analyst_id: string | null
  occurred_date: string | null
  satisfaction_label: string | null
}

export type VerifiedQualitativeSelection =
  | {
      ok: true
      ticket: {
        clickdesk_ticket_id: string
        analyst_id: string
        area: null
        satisfaction_label: string | null
        occurred_date: string | null
        identity_role: 'analyst'
      }
    }
  | { ok: false; status: 403 | 404 | 422; error: string }

/**
 * Validates the verified capture record before permitting ticket-level analysis.
 * Never authorizes an analyst based on ticket ID alone: the analyst ID must match.
 */
export function selectVerifiedQualitativeTicket(
  ticketId: string,
  rows: VerifiedQualitativeCandidate[],
  isManagement: boolean,
  chatAnalystId: string | null,
): VerifiedQualitativeSelection {
  if (!isManagement && !chatAnalystId) {
    return { ok: false, status: 403, error: 'Acesso individual sem analista vinculado.' }
  }
  const eligible = rows.filter(
    (row) =>
      String(row.ticket_id) === ticketId &&
      (isManagement || row.analyst_id === chatAnalystId),
  )
  if (!eligible.length) {
    return {
      ok: false,
      status: 404,
      error: 'Atendimento não encontrado na sua base individual ou na captura verificada.',
    }
  }

  const distinctAnalysts = new Set(eligible.map((row) => row.analyst_id))
  if (isManagement && distinctAnalysts.size > 1) {
    return {
      ok: false,
      status: 422,
      error: 'O ticket possui mais de um analista verificado; informe a autoria antes da análise.',
    }
  }

  const contribution = eligible[0]
  if (!contribution.analyst_id) {
    return {
      ok: false,
      status: 422,
      error: 'Atendimento sem vínculo de analista para salvar a análise.',
    }
  }
  return {
    ok: true,
    ticket: {
      clickdesk_ticket_id: String(contribution.ticket_id),
      analyst_id: contribution.analyst_id,
      area: null,
      satisfaction_label: contribution.satisfaction_label,
      occurred_date: contribution.occurred_date,
      identity_role: 'analyst',
    },
  }
}

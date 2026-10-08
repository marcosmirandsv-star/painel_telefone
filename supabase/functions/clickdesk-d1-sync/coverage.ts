/** Diagnóstico conservador: jamais considerar uma coleta vazia como saudável
 * quando os relatórios oficiais confirmam atividade humana nas filas monitoradas.
 * Não confundir 'atendimentos recebidos' do relatório com 'primeiras respostas humanas'.
 */
export function verifyHumanTicketCoverage(params: {
  ticketCollectionSize: number
  reportAgentReceived: number
}): { ok: boolean; code: 'ok' | 'empty_with_report_activity' | 'no_reference_activity' } {
  const { ticketCollectionSize, reportAgentReceived } = params
  if (!Number.isSafeInteger(ticketCollectionSize) || ticketCollectionSize < 0 ||
      !Number.isSafeInteger(reportAgentReceived) || reportAgentReceived < 0) {
    throw new Error('Invalid ClickDesk coverage metrics')
  }
  if (ticketCollectionSize === 0 && reportAgentReceived > 0) {
    return { ok: false, code: 'empty_with_report_activity' }
  }
  if (ticketCollectionSize === 0) {
    return { ok: true, code: 'no_reference_activity' }
  }
  return { ok: true, code: 'ok' }
}

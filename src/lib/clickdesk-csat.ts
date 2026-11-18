/**
 * Fonte única de cálculo dos indicadores de CSAT da amostra auditada ClickDesk.
 *
 * Um ticket = no máximo uma avaliação, atribuída ao último autor público
 * humano comprovado no ledger. O consolidado NÃO é a média simples dos CSATs
 * dos analistas: é a razão entre todas as avaliações positivas e avaliadas.
 */
export type ChatVoteRow = {
  attendances: number
  positive_reviews: number
  negative_reviews: number
}

export function sumChatVoteRows(rows: readonly ChatVoteRow[]) {
  const sum = rows.reduce((acc, row) => ({
    attendances: acc.attendances + Number(row.attendances),
    positives: acc.positives + Number(row.positive_reviews),
    negatives: acc.negatives + Number(row.negative_reviews),
  }), { attendances: 0, positives: 0, negatives: 0 })
  const reviews = sum.positives + sum.negatives
  if (
    !Number.isSafeInteger(sum.attendances) || !Number.isSafeInteger(sum.positives) ||
    !Number.isSafeInteger(sum.negatives) || sum.attendances < 0 || sum.positives < 0 ||
    sum.negatives < 0 || reviews > sum.attendances
  ) throw new Error('invalid_chat_vote_totals')
  return {
    ...sum,
    reviews,
    csat: reviews ? Math.round(sum.positives / reviews * 10000) / 100 : null,
    reviewPercentage: sum.attendances
      ? Math.round(reviews / sum.attendances * 10000) / 100
      : null,
  }
}

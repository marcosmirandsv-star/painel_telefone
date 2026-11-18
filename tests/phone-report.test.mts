import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparePhoneCsat,
  getPreviousPhoneCalendarMonth,
  loadPhoneMetricPages,
  getPhoneCsatBenchmark,
  getPhoneFeedbackFocus,
} from '../src/lib/phone-report.ts'

test('a referência competitiva respeita a elegibilidade do ranking', () => {
  const ranking = [
    { analystName: 'Primeiro', averageCsat: 99.12, eligible: true },
    { analystName: 'Segundo', averageCsat: 95.88, eligible: true },
    { analystName: 'Terceiro', averageCsat: 94.68, eligible: true },
    { analystName: 'Quarto', averageCsat: 94.28, eligible: true },
    { analystName: 'Quinto', averageCsat: 92.41, eligible: true },
    { analystName: 'Bruno', averageCsat: 91.71, eligible: true },
    { analystName: 'Sem volume mínimo', averageCsat: 98.82, eligible: false },
  ]
  assert.deepEqual(getPhoneCsatBenchmark(ranking, 6), {
    analystName: 'Terceiro', csat: 94.68, gap: 2.97,
  })
  assert.equal(getPhoneCsatBenchmark(ranking, 1), null)
  assert.equal(getPhoneCsatBenchmark(ranking, 7), null)
  assert.equal(getPhoneCsatBenchmark(ranking.slice(0, 2), 6), null)
})

test('a orientação trata as metas pendentes antes da manutenção e usa a referência competitiva', () => {
  const met = {
    csat: 91.71, csatGoal: 90, podiumCsatGoal: 90,
    reviewPercentage: 33.33, reviewGoal: 25, totalTickets: 399, averageTickets: 325.2,
  }
  assert.equal(getPhoneFeedbackFocus({ ...met, benchmarkGap: 2.97, csatDelta: -0.48 }), 'csat')
  assert.equal(getPhoneFeedbackFocus({ ...met, benchmarkGap: 2.97, csatDelta: 1 }), 'csat')
  assert.equal(getPhoneFeedbackFocus({ ...met, csat: 89, reviewPercentage: 20 }), 'csat')
  assert.equal(getPhoneFeedbackFocus({ ...met, csat: 0, reviewPercentage: 0 }), 'reviews')
  assert.equal(getPhoneFeedbackFocus({ ...met, csat: 88, csatGoal: 86 }), 'csat')
  assert.equal(getPhoneFeedbackFocus({ ...met, reviewGoal: 40, benchmarkGap: 2.97 }), 'reviews')
  assert.equal(getPhoneFeedbackFocus({ ...met, totalTickets: 200, benchmarkGap: 2.97 }), 'volume')
  assert.equal(getPhoneFeedbackFocus({ ...met, csatDelta: -0.48 }), 'csat')
  assert.equal(getPhoneFeedbackFocus({ ...met, csatDelta: 0.5 }), 'maintenance')
})

test('a competência de outubro compara com setembro inteiro', () => {
  assert.deepEqual(getPreviousPhoneCalendarMonth('2026-10-01', '2026-10-31'), {
    start: '2026-09-01', end: '2026-09-30',
  })
  assert.deepEqual(getPreviousPhoneCalendarMonth('2024-03-01', '2024-03-31'), {
    start: '2024-02-01', end: '2024-02-29',
  })
  assert.equal(getPreviousPhoneCalendarMonth('2026-10-01', '2026-10-30'), null)
})

test('a variação usa CSAT ponderado e exige avaliações nos dois períodos', () => {
  const previous = [
    { csat: 90, total_reviews: 30, total_tickets: 100 },
    { csat: 100, total_reviews: 10, total_tickets: 50 },
  ]
  assert.deepEqual(comparePhoneCsat({ csat: 93, reviews: 100 }, previous), {
    csat: 92.5, delta: 0.5,
  })
  assert.equal(comparePhoneCsat({ csat: 93, reviews: 100 }, []), null)
  assert.equal(comparePhoneCsat({ csat: 0, reviews: 0 }, previous), null)
  assert.equal(comparePhoneCsat({ csat: 93, reviews: 100 }, [{ ...previous[0], total_reviews: 0 }]), null)
  assert.deepEqual(comparePhoneCsat({ csat: 93, reviews: 100 }, [{ ...previous[0], csat: 0 }]), {
    csat: 0, delta: 93,
  })
})

test('o painel carrega períodos antigos e rejeita histórico parcial se a paginação falhar', async () => {
  const rows = Array.from({ length: 580 }, (_, index) => ({ id: index }))
  const loaded = await loadPhoneMetricPages(async (from, to) => ({
    data: rows.slice(from, to + 1), error: null,
  }))
  assert.deepEqual(loaded, { data: rows, error: null })

  const error = { message: 'Página indisponível' }
  const incomplete = await loadPhoneMetricPages(async (from, to) => from === 0
    ? { data: rows.slice(from, to + 1), error: null }
    : { data: null, error })
  assert.deepEqual(incomplete, { data: null, error })
})

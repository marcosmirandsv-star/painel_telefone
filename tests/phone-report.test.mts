import assert from 'node:assert/strict'
import test from 'node:test'
import {
  comparePhoneCsat,
  getPreviousPhoneCalendarMonth,
  loadPhoneMetricPages,
} from '../src/lib/phone-report.ts'

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

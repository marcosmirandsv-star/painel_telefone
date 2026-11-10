import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const helpers = new Set(['normalizeChatText', 'normalizeChatColumn', 'findChatColumn', 'getChatRowValue', 'buildChatMetricRowsFromSheets', 'getChatMetricStatus'])
const declarations = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && node.name && helpers.has(node.name.text))
  .map((node) => node.getText(ast)).join('\n')
const compiled = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
const build = new Function('round', `${compiled}\nreturn buildChatMetricRowsFromSheets;`)(
  (value: number) => Math.round(value * 100) / 100,
)
const base = {
  analysts: [{ id: 'analyst', name: 'Analista Exemplo', team_id: 'team', active: true, csat_goal: 90 }],
  year: 2026, monthNumber: 10, monthLabel: 'Outubro 2026', periodStart: '2026-10-01', periodEnd: '2026-10-31',
}

test('arquivos Zendesk com os cabeçalhos reais mantêm as fórmulas originais e descontam inativos', () => {
  const satisfactionRows = ['Boa', 'Ruim', '', '', ''].map((rating, index) => ({
    'ID do ticket': String(index + 1), 'Nome do atribuído': 'Analista Exemplo',
    'índice de satisfação do ticket (Boa/Ruim/vazio)': rating, Tickets: 1,
  }))
  const inactiveRows = [{ 'ID do ticket': '3', 'Nome do atribuído': 'Analista Exemplo', Satisfação: 'Não Oferecida', Tickets: 1 }]
  const [metric] = build({ ...base, satisfactionRows, inactiveRows })
  assert.deepEqual({ total: metric.total_tickets, inactive: metric.inactive_tickets, valid: metric.valid_tickets,
    positive: metric.positive_reviews, negative: metric.negative_reviews, reviews: metric.reviews,
    csat: metric.csat, participation: metric.review_percentage, withoutReview: metric.sending_percentage },
  { total: 5, inactive: 1, valid: 4, positive: 1, negative: 1, reviews: 2, csat: 50, participation: 50, withoutReview: 50 })
})

test('a importação mensal lê ambas as planilhas Zendesk antes de gravar e usa o cálculo original', () => {
  let handler: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleChatMonthlyImport') handler = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(handler)
  const calls: string[] = []
  function collect(node: ts.Node) {
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast))
    ts.forEachChild(node, collect)
  }
  collect(handler)
  assert.equal(calls.filter((name) => name === 'readSheetRows').length, 2)
  assert.ok(calls.includes('buildChatMetricRowsFromSheets'))
  assert.ok(!calls.some((name) => /ClickDesk/.test(name)))
  assert.ok(calls.indexOf('buildChatMetricRowsFromSheets') < calls.findIndex((name) => name.includes('.upsert')))
})

# Fechamento ClickDesk de outubro e publicação D-1

Escopo: somente homologação, Supabase vvtorcvchnqhcredhorv. Produção preservada.

Fontes: relatório de Atendentes, filas Suporte ERP (3) e Fiscal (12), 01–31/10/2026,
conferido em 03/11 pela API; CSV de avaliações do mesmo período fornecido pela gestão.

## Resultado conciliado

| Analista | Resolvidos | Positivas | Negativas | Avaliações |
|---|---:|---:|---:|---:|
| João Pedro Vianey | 621 | 137 | 29 | 166 |
| João Vitor Almeida | 485 | 86 | 32 | 118 |
| Thiago Reis | 496 | 114 | 27 | 141 |
| Carlos Lemos / Carlos Henrique | 352 | 68 | 14 | 82 |
| Paulo Victor | 389 | 103 | 18 | 121 |
| Vanessa Silva | 351 | 56 | 26 | 82 |
| Diego Machado | 386 | 98 | 15 | 113 |
| Mario Junior | 369 | 85 | 12 | 97 |
| Igor Siqueira | 359 | 72 | 22 | 94 |
| Polliana Santana | 312 | 45 | 18 | 63 |
| Karolyne Moreira | 315 | 51 | 16 | 67 |
| Maycon Oliveira | 243 | 50 | 14 | 64 |
| Miguel Augusto | 242 | 42 | 16 | 58 |
| João Pedro Santana | 235 | 48 | 6 | 54 |
| Christian Matozinho | 233 | 39 | 15 | 54 |
| **Total** | **5.388** | **1.094** | **280** | **1.374** |

CSAT = 1094 / (1094 + 280) = **79,62%**; nunca média dos percentuais individuais.
Por lotação: Chat Notas/Fiscal = 2694 resolvidos, 564 positivas, 146 negativas,
710 avaliações, CSAT 79,44%; Chat Outros/ERP = 2694 resolvidos, 530 positivas,
134 negativas, 664 avaliações, CSAT 79,82%.

Excluídos: Carine Melo, Lucas Emmanuel, Polyana Ventura, Lorena Almeida,
Luan Pereira, Ronei Marcos, Ana Julia, David Leodoro e notas sem atendente avaliado.
Somente os 15 membros cadastrados do recorte humano aprovado entram no resultado;
a avaliação avulsa de Larissa Brito não pertence a esse conjunto.
Os cadastros e acessos de pessoas não foram desativados.

## Causas corrigidas

- Captura de volume não restringia as filas ERP/Fiscal, apesar de restringir as notas.
- `conversations` significa conversas respondidas; o denominador mensal da performance
  passa a usar `resolved`, reproduzindo a coluna Resolvidos já utilizada na importação.
- ID ClickDesk 23 vincula Carlos Henrique a Carlos Lemos, sem duplicar cadastro.
- O CSV deve agrupar avaliações por `Atendente avaliado`, não por responsável atual.
  Mudança de responsável após uma nota não altera sua autoria histórica.
- Avaliações são deduplicadas por `ticket_id`; `number` é apenas exibição.
- Falha de paginação, votos conflitantes ou divergência de `csat_total` impedem salvar
  uma captura incompleta por cima da anterior.
- RPC oficial filtra a mesma população para gestão e analista e conserva isolamento.

## D-1

A captura oficial padrão termina no dia anterior em America/Sao_Paulo. No primeiro
dia do mês, termina no último dia do mês anterior. Filtros manuais não podem liberar
o dia atual; o leitor compartilhado do ledger também aplica o corte.
O agendamento pode verificar a origem várias vezes ao dia sem publicar resultados de hoje.
Não foi prometido horário fixo para a primeira atualização do dia.

## Limites preservados

O relatório mensal não comprova distribuição diária nem conciliação dos transcripts.
Por isso ele não é mais exibido artificialmente como movimento inteiro no último dia.
Régua diária, evidências e IA continuam vinculadas ao ledger e não recebem cobertura
completa apenas porque o total mensal está conciliado. Não há promoção para produção.

Validação: 133 testes de integração, 14 de escalas, TypeScript e build aprovados;
captura real de outubro HTTP 200 com 15 titulares e os totais acima; captura D-1
real em 03/11 com término 02/11; RPC gerencial reproduz o fechamento.
Inspeção visual autenticada deve ser registrada separadamente, sem inferir aprovação
apenas dos testes automatizados e da consulta administrativa.

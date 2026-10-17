# Auditoria da divergência entre indicadores — 17/10/2026

## Diagnóstico reproduzido no banco de homologação
As duas tabelas na mesma aba mostram conceitos distintos, mas estavam apresentadas como se fossem métricas comparáveis:

| Analista | Ledger: atendimentos finais | Captura auxiliar: participações |
|---|---:|---:|
| João Pedro Vianey | 123 | 318 |
| João Vitor Almeida | 151 | 287 |
| Paulo Victor | 94 | 223 |
| Carlos Lemos | 88 | 217 |
| Lorena Almeida | 88 | 185 |
| Thiago Reis | 267 | 208 |
| Vanessa Silva | 247 | 200 |

João Pedro: apenas 106 IDs pertencem a ambos os conjuntos para seu cadastro; 17 estão somente no ledger e 212 somente na captura auxiliar dentro do período. A diferença não prova atendimentos perdidos nem duplicações: participação por analista e titularidade final são coisas diferentes.

João Pedro: 96,88% na principal (31 positivas / 32 avaliações, 123 atendimentos) contra 84,62% na captura (11 positivas / 13 avaliações, 318 participações). Não usar participações como denominador de % de avaliações.

Da coorte de outubro havia 415 tickets avaliados no ledger, mas somente 80 tinham avaliação equivalente no mesmo titular na captura auxiliar naquele recorte. Os outros 335 não possuem correspondência de avaliação naquela fonte — isso NÃO prova que faltam avaliações no ClickDesk.

## Causas técnicas
1. A rota /api/clickdesk/metrics lê clickdesk_final_ticket_ledger: um ticket creditado à última resposta pública humana confirmada, com avaliação atribuída a esse titular. A rota /api/clickdesk/verified-coverage lê clickdesk_chat_verified_contributions: registra o ticket para cada humano que participou; não é crédito final.
2. A função clickdesk-verified-capture v7 (inspecionada no Supabase) chama GET /tickets/{id}/messages sem paginação integral, registra a primeira resposta por pessoa e calcula atribuição de avaliação apenas com o histórico recebido. O algoritmo do ledger lê histórico paginado completo e a última resposta pública confirmada. Logo, a amostra antiga não pode gerar CSAT operacional comparável.
3. As duas rotas têm diferentes momentos de atualização: a principal busca ledger a cada 5 minutos, a auxiliar só quando a aba é aberta ou filtros mudam. Não compartilham snapshot atômico.
4. O endpoint auxiliar não filtrava nem sinalizava inativos; Ana Claudia Corrêa (active=false) aparecia entre analistas atuais. A apresentação na mesma aba e o segundo CSAT induziam à interpretação incorreta.

## Correção visual segura
- Equipe e produtividade mostra somente a fonte do ledger para atendimentos, CSAT e avaliações; mantém a ressalva de cobertura parcial.
- A captura auxiliar foi deslocada para Ferramentas → Conferência da base, fechada por padrão e identificada como auditoria de participações, não de desempenho.
- O percentual CSAT da fonte auxiliar foi retirado do endpoint e da interface. Contagens de participações e avaliações da captura continuam visíveis só como material de auditoria e analistas inativos são sinalizados.
- Nenhuma modificação nos tickets, avaliações, banco, ClickDesk, fórmulas, metas, pódio, telefone, produção ou autenticação.

## Pendências futuras distintas
Concluir a reconciliação histórica antes de fechamento oficial; conferir casos questionados por ticket no histórico completo; manter a IA 360º vinculada exclusivamente ao ledger.

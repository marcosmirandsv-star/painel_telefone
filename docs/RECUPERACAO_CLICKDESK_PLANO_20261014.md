# Auditoria e plano vinculante — ClickDesk (14/10/2026)

**Referência principal:** Relatório de auditoria 14/10/2026, também salvo na Biblioteca ChatGPT em `/Central de Performance/relatorio_auditoria_central_performance_2026-10-14.md`. Antes de novos PRs, consultar este documento.

## Regras intocáveis
- Um ticket conta como **um** atendimento, exclusivamente ao **último autor humano que respondeu publicamente**, com mensagem comprovada. A avaliação, quando existe, acompanha o mesmo dono. Sem avaliação não é negativo.
- Aprendizes Ana Júlia e David **excluídos**; jamais redistribuir o ticket deles ao analista anterior.
- Equipe do analista e fila operacional são atributos distintos. Critérios aplicados a Especializado/Fiscal e Outros/ERP; metas individuais e pódio mantidos; Telefone não alterado.
- Estado "sem dados"/erro/pendência **não é zero** nem "metas saudáveis".
- Produção e credenciais/rotinas de produção não podem ser alteradas no projeto de recuperação.

## Linha de base
| Evidência | Observação |
|---|---|
| Fonte legacy `clickdesk_chat_attendances` | 1.205 tickets; última competência 02/10 |
| Fonte verified `clickdesk_chat_verified_contributions` | 2.226 participações, 2.038 tickets; datas 03–14/10 |
| Universo de candidatos das duas fontes | 3.243 tickets distintos no snapshot da auditoria |
| `clickdesk_chat_daily_metrics` | Última data 02/10; não cobre reconciliação atual |
| Ciclos automáticos de 03/10 em diante | 125 `completed` com 0 tickets recebidos |
| `clickdesk_chat_report_snapshots` | 220 snapshots Fiscal e ERP; `human_answered=0` em todos, apesar de atividade |
| Coorte auditada 692 IDs | 683 confirmados, 9 pendentes; 500 créditos a Vanessa/Thiago/Karolyne (01–13/10), 32 negativos |
| Controle 1054367 | Thiago Reis, mensagem 3448139, 06/10/26 12:57:32 BRT |
| PR #24 | `611ea156`, conciliação sob demanda das rotas |
| PR #25 | `b627c8c6`, estado de erro mais explícito e ajuste de credenciais |
| Limitação conhecida | Lógica de atendimento na leitura processa candidatos globalmente, com limite 240s e carga REST elevada |

## Plano e portões de aceite
0. Congelar e registrar linha de base; nenhuma mudança de regra.
1. Diagnóstico e telemetria segura de HTTP/latência/cobertura (sem JWT, chaves, PII ou mensagens).
2. Validar descoberta e paginação de tickets, em dry-run, com controles 03/10, 05/10, 06/10 e 13/10; explicar diferenças de criado, escalado, respondido, resolvido e avaliado.
3. Construir ledger incremental e idempotente de evidências mínimas, com pendências segregadas, usando somente homologação após validação de amostra.
4. Tornar `metrics`, `history` e `tickets` consultas rápidas do ledger; aplicar filtros/autorização no backend; nenhuma varredura histórica no request de UI.
5. Garantir fonte comum e igualdade de métricas entre gestor/analista nas duas equipes. Excluir aprendizes e preservar metas.
6. Testar regras, isolamento, fila e competência, monitorar empty-sync e cobertura; sem entrega a produção antes de aceite autenticado.

## Governança
Separar **descoberto**, **verificado**, **atribuído** e **cobertura completa**. Nenhum total parcial é oficial; relatórios agregados não são automaticamente comparáveis a créditos humanos. Qualquer falha de uma etapa bloqueia a declaração de conclusão. Trabalhos devem ser PRs isolados na homologação, com CI aprovado e evidências. O usuário autorizou a execução das etapas deste relatório em 14/10/2026; não implica autorização para alterar produção.

## Checklist de execução
- [x] Relatório preservado na Biblioteca ChatGPT.
- [x] Linha de base registrada.
- [ ] Instrumentação autenticada e diagnóstico confirmado.
- [ ] Cobertura e paginação confirmadas.
- [ ] Reconciliação incremental validada e armazenada na homologação.
- [ ] Rotas rápidas e protegidas implantadas.
- [ ] Paridade Gestor/Analista comprovada.
- [ ] Smoke test, observabilidade e aprovação funcional.

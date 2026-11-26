# Central de Performance — verificação de pendências (22/11/2026)

## Princípio de aceite
Menos telas, mais inteligência, menos cliques e informações mais claras. Sem adulterar CSAT, autoria final, origem da captura ou históricos. Nenhuma lacuna da base pode virar zero inferido.

## Interface (PR #113)
- **Analista:** "Dias e evolução" reúne o caminho de acesso para detalhamento diário de tickets e série mensal ClickDesk; histórico Zendesk permanece recolhido.
- **Gestor:** auditoria de neutros está recolhível dentro da Visão 360º; a URL histórica ?view=neutralAudit continua suportada pelo roteamento existente.
- **Operação:** gráfico diário permanece prioritário; régua com valores por dia/lacunas fica recolhível.
- **Fonte de evidência:** diff do PR #113 e Preview Vercel READY no commit eb041ad7badb8a76ff499c76b42d173e520fdac5.
- **Não validado:** navegação autenticada como gestor e analista, acessibilidade, responsividade e leitura após login. READY significa compilação/deploy da Preview, não aprovação funcional.

## Verificações realizadas por leitura em produção Supabase qmetbydkepfdgfqkdkai
- clickdesk_final_ticket_ledger: **0** linhas.
- clickdesk_360_work_queue: **0** linhas.
- clickdesk_qualitative_analyses: **0** linhas.
- clickdesk_360_worker_health: **0** linhas.
- clickdesk_neutral_reviews: **143** linhas, todas com status **pending**.
- clickdesk_official_capture_tasks: **12.620** tarefas, **12.605 complete** e **15 pending**, no instante da consulta.
- clickdesk_official_period_metrics: dias completos do quadro consultado em 17/11 (15 proprietários, 143 recebidos), 18/11 (15, 120), 19/11 (15, 112). Em 20/11 há 15 proprietários e apenas 8 recebidos em fotografia provisória: não declarar o dia reconciliado sem conferência contra a competência.
- cron.job: tarefas de captura oficial e recuperação CX360 ativas. Cron com sucesso SQL não comprova o processamento qualitativo: as tabelas finais continuam vazias.

## Bloqueios de aceite e ações necessárias
1. **Inventário 360º:** construir/validar ingestão verificável de ID de ticket, última resposta pública humana e transcrição/evidência. Só alimentar clickdesk_final_ticket_ledger após validação de unicidade, autoria e período. Não importar automaticamente as 346 análises legadas.
2. **Fila e análise qualitativa:** com ledger correto, enfileirar com idempotência e validar processamento real da régua CX v3; conferir status e erros no worker, cobertura e casos exemplares. Distinguir dado não disponível de qualidade ruim.
3. **Neutros:** cada um dos 143 itens pendentes requer evidência e validação de causa. Não excluir nota 3 de CSAT por ausência de prova de falha humana. Excluir apenas fator externo comprovado segundo regra oficial.
4. **Calendário diário:** completar capturas individuais faltantes do intervalo, inclusive os 15 blocos pendentes do snapshot observado; conciliar todas as datas e profissionais com o resultado mensal. Não tratar zero técnico como volume zero real.
5. **UX e perfis:** abrir a Preview autenticada em Chrome desktop/mobile; testar os menus de Telefone, Chat, Sistema, Férias, relatórios, alterações autorizadas, filtros e erros. Confirmar privacidade do analista na UI, API e RLS.
6. **Publicação:** somente após a comprovação dos itens relevantes ao release, integrar PR #113 e verificar o deployment em produção. Não confundir merge com encerramento de todos os bloqueios técnicos.

## Estado ao fim desta revisão
**Aprovado apenas para validação em Preview.** Não declarar a Central integralmente concluída enquanto faltar calendário mensal reconciliado, inventário 360º com evidências e testes autenticados. Este documento preserva o trabalho já realizado e evita repetição de testes anteriores sem motivo.

# Estado atual da Central de Performance — 06/10/2026

## Objetivo atual

Estabilizar e evoluir a Central de Performance em homologação usando a nuvem como fonte de verdade:

`GitHub homologacao -> Vercel Preview -> Supabase homologacao`

Produção (`main`) permanece fora do escopo até aprovação explícita.

## Fontes confirmadas

- Repositório: `marcosmirandsv-star/painel_telefone`
- Branch oficial de homologação: `homologacao`
- Head após a rodada de estabilização: `c88ce837260e492799a3311480ed5658acb31771`
- Supabase homologação: `vvtorcvchnqhcredhorv`
- Projeto Vercel identificado pelos status GitHub: `project-gestao/central-performance`
- Framework: Next.js 16.2.10, React 19.2.4, TypeScript

## Saúde técnica confirmada

No head `c88ce837...`:

- GitHub Actions da homologação: sucesso
- testes de escala: sucesso
- testes de integração: sucesso
- build Next.js/TypeScript: sucesso
- status Vercel do commit: sucesso

O pipeline não executa `npm run lint`; isso continua como melhoria de CI.

## Correções encerradas nesta rodada

A Home executiva havia sido introduzida em commits posteriores ao último estado verde, mas a branch deixou de compilar.

Foram corrigidos dois defeitos de escopo/TypeScript sem alteração de regra de negócio:

1. uso de `formatNumber`, inexistente, substituído pelo formatter já existente `formatChatCount`;
2. a Home referenciava variáveis locais de `DashboardView` (`periodAverageCsat`, `periodTeamPerformance`, `attentionList`, `periodLabel`). A Home passou a calcular seu snapshot do Telefone no escopo correto reutilizando as funções existentes.

Depois disso, a Home do Chat deixou de usar `chat_monthly_metrics` como fotografia operacional e passou a consultar snapshots oficiais agregados do ClickDesk por rota autenticada de gestão.

## Home executiva — regra vigente

### Telefone

A Home exibe o último período lançado disponível no banco.

Não deve ser apresentado como dado de hoje.

A base semanal disponível atualmente termina em 18/09/2026.

### Chat

A Home usa `clickdesk_chat_report_snapshots`.

Campos apresentados:
- CSAT agregado oficial;
- Entraram (`report_created`);
- Resolvidos (`report_resolved`);
- abertos agora (`report_open_now`);
- aguardando agora (`report_waiting_now`);
- data/hora de captura.

`open_now` e `waiting_now` são estado atual e não acumulado histórico.

`human_answered` não é usado como KPI da Home.

A Home não usa `clickdesk_chat_attendances` para provar autoria histórica enquanto a reconciliação individual não estiver validada.

## Estado do ClickDesk persistido

Contagens observadas em homologação:

- `clickdesk_chat_attendances`: 1205
- `clickdesk_chat_daily_metrics`: 119
- `clickdesk_chat_report_snapshots`: 56
- `clickdesk_chat_sync_runs`: 103
- `clickdesk_qualitative_analyses`: 148

### Ponto crítico

A persistência individual/detalhada está atualizada somente até 02/10/2026:

- último `occurred_date` em `clickdesk_chat_attendances`: 02/10/2026
- último `occurred_date` em `clickdesk_chat_daily_metrics`: 02/10/2026

Ao mesmo tempo, os snapshots oficiais agregados seguem sendo capturados no dia 06/10/2026.

Os sync runs horários recentes aparecem como `completed`, mas com zero linhas individuais recebidas/upsertadas. Portanto:

- a camada agregada oficial está viva;
- a camada individual histórica está incompleta;
- uma não deve ser usada como prova da outra.

## Reconciliação ClickDesk

Edge Function:

- slug: `clickdesk-reconcile`
- versão: v6
- status: ACTIVE
- SHA: `4af752d019a646205c9495fb0df169752b8936f0ea3d0eeb5d13ce85010c7ebe`
- diagnostic-only
- `dry_run=true`
- sem persistência
- sem cron

Decisão vigente:

- não criar v7;
- não habilitar persistência;
- não alterar cron;
- próximo gate: fixture independente de 03/10/2026 com 17 atividades humanas comprovadas;
- depois: diagnóstico completo de 05/10/2026;
- só depois decidir modelo de persistência.

## Estrutura atual do produto

### Módulos principais

- Central
- Telefone
- Chat
- Sistema

O módulo Escalas existe em código/banco, porém está pausado por decisão de produto.

### Chat

Áreas existentes:
- Visão da operação
- Análise 360º
- Equipe e produtividade
- Gestão e ações
- Fechamento mensal
- Conferência da base
- Importação
- Cadastros
- Fechamentos oficiais

### Telefone

Mantém:
- dashboard;
- performance;
- CSAT;
- pódio;
- metas;
- relatórios;
- SARE/MIMO;
- acesso individual;
- IA de gestão já existente.

## Perfis e autorização

Enum atual no banco:
- `master`
- `coordenadora`
- `analista`

O papel Gestor com escopo por equipe ainda não existe estruturalmente.

A aplicação e `/api/users` também reconhecem apenas esses papéis.

Decisão: não implementar Gestor parcialmente em uma única tela. O escopo deve ser desenhado para todo o Chat e respectivas RLS/APIs.

## Equipes e cadastro

Banco atual:

### Chat Notas / Marcos
- 9 registros
- 7 ativos
- Ana Claudia Corrêa: inativa
- Rayane Nunes: inativa

### Chat Outros / Polyana
- 11 registros
- 10 ativos
- Ismael Chagas Bessa: inativo

### Menores aprendizes

Regra confirmada em 07/10/2026:

- `Ana Julia` é menor aprendiz;
- `David Leodoro` é menor aprendiz;
- os atendimentos deles não entram em produtividade, CSAT, cobertura de avaliações, pódio, 360º ou pendência de mapeamento;
- eles não devem ser cadastrados em `chat_analysts` como analistas de performance.

O vínculo ClickDesk deles permanece preservado para auditoria com `person_role = apprentice`, e os registros detalhados usam `identity_role = apprentice`.

A operação agregada oficial do ClickDesk continua representando o volume total real da fila; a exclusão vale para métricas derivadas de desempenho individual/equipe a partir da base detalhada.

Também existem vínculos não mapeados ou de gestão que não devem ser promovidos a analista por inferência.

## Regra de propriedade do atendimento

Fila e equipe de origem são conceitos independentes.

- equipe do analista vem do registry;
- fila atual/final não define equipe;
- N2 é camada compartilhada de escalonamento ERP/Fiscal;
- N3 corresponde ao antigo fluxo N2 do Zendesk;
- owner, nota interna ou fila final isoladamente não provam atendimento humano.

## Análise 360º

O código atual diferencia duas coisas:

1. processamento progressivo do universo da operação;
2. fila/amostra de validação humana.

A rota de operação 360º mantém fila de avaliações não analisadas e trabalha cobertura até o universo do filtro.

A tela/resumo qualitativo mantém amostra distribuída de até 5 negativas e 5 positivas para revisão humana.

Portanto, `5 + 5` não deve ser interpretado como limite do universo processável do 360º.

## Banco e segurança

RLS está ativo nas principais tabelas de perfis, métricas, Chat, attendances, sync runs e análises qualitativas.

Pendências do Security Advisor:

- RLS ativo sem policy em algumas tabelas internas, incluindo `clickdesk_chat_report_snapshots`;
- sete funções `SECURITY DEFINER` executáveis por `authenticated`, várias delas helpers intencionais de self-service e autorização, mas que devem continuar sob revisão;
- proteção contra senhas vazadas desabilitada.

Observação: `clickdesk_chat_report_snapshots` é consumida pela nova Home somente por rota server-side autenticada de gestão, não por leitura direta do browser.

Pendências de performance incluem FKs sem índice e avisos de policies permissivas. Não alterar sem medir impacto e revisar intenção.

## Dívida técnica

`src/app/page.tsx` concentra grande parte da aplicação e possui aproximadamente 18,5 mil linhas.

Isso é dívida técnica real, mas não deve ser atacado com refatoração ampla antes de estabilizar os fluxos críticos e os dados.

A branch `homologacao` também está centenas de commits à frente de `main`; promoção futura deve ser por release candidata revisada, nunca merge cego.

A branch `homologacao` não possui proteção obrigatória no GitHub. Alterações devem continuar passando por branch + PR + testes, mesmo sem enforcement do repositório.

## Cron atual

- `schedule-transport-reminders-daily`: diário
- `clickdesk-chat-intraday-hourly`: horário operacional
- `clickdesk-chat-360-hourly`: ciclos durante a janela operacional

Não alterar nesta fase.

## Decisões fechadas

1. Cloud-first: local não é fonte de verdade da homologação.
2. Produção intocada.
3. Homologação alterada somente por branch controlada + PR.
4. Evidência vence memória/documentação antiga.
5. Home do Chat usa snapshot oficial agregado, não base mensal legada.
6. Estado atual e acumulado não são misturados.
7. Reconciliação v6 permanece congelada.
8. Não inferir autoria, equipe ou histórico sem evidência.
9. Não usar 322 ou 351 como alvo da reconciliação.
10. Módulo Escalas permanece fora do escopo ativo.

## Pendências priorizadas

### P0 — confiança operacional
- validar visualmente a Home executiva autenticada quando o acesso Vercel permitir;
- confirmar runtime/console do novo endpoint de overview;
- manter GitHub Actions e Vercel verdes;
- concluir gate v6 de 03/10 quando houver execução autenticada disponível.

### P1 — qualidade dos dados
- manter Ana Júlia e David Leodoro classificados como menores aprendizes e fora dos indicadores de performance;
- explicar/recuperar a lacuna da persistência individual após 02/10 via trilha de reconciliação;
- revisar se dados do Telefone posteriores a 18/09 precisam ser lançados/importados.

### P2 — autorização
- desenhar papel Gestor por equipe para Chat inteiro;
- implementar depois RLS, APIs e interface de forma coerente.

### P3 — segurança/hardening
- revisar findings atuais do Security Advisor;
- decidir leaked-password protection;
- tratar índices/policies somente após validação de impacto.

### P4 — manutenção
- adicionar lint ao pipeline;
- reduzir gradualmente a concentração de código em `src/app/page.tsx` depois da estabilização.

## Próximo gate

Com a Home técnica novamente compilando/deployando e usando fonte operacional oficial do Chat, o próximo trabalho independente da v6 é:

1. validar e documentar o comportamento da Home com snapshots reais;
2. corrigir gaps cadastrais confirmados;
3. revisar Telefone quanto à atualização dos dados;
4. manter a trilha v6 separada até o gate 03/10.

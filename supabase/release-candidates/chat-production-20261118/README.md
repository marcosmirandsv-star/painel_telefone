# Candidato de promoção do Chat — 18/11/2026

**Preparado para revisão. Nada deste diretório foi aplicado ou ativado em produção.**

Destino único: `qmetbydkepfdgfqkdkai`, aplicação `painel-telefone.vercel.app`.
Base da aplicação: `222b577696a02d378a6a43ad9053995e91427d70` (inclui CX360 PR88).
Não mesclar a branch homologacao inteira. Este candidato isola o Chat em `/chat`.

## Evidências disponíveis

- HML publicada com PR89/90: filtros, ajuda, conversas, avaliações e expandir/recolher conferidos em sessão real de Thiago Reis.
- Semana 09–15/11 publicada em HML em 18/11 às 18:20:05 UTC: job `e261a9c2-4c4c-4db7-8c8d-cc1b25d7daa0`, 20/20 checkpoints, 15 responsáveis, 691 Recebidos e 216 votos (201/15), IDs únicos e nenhum fora do período. Os 15 cabeçalhos individuais coincidem com o banco. Thiago: 38/19 (18/1), CSAT 94,74%, média de sua equipe 43. RLS: 19 próprios, zero alheios.
- Outubro em HML: 5395 Recebidos / 1374 avaliações (1094/280), conferido anteriormente para os 15 responsáveis.
- Backup local de produção de 18/11 17:43:57 UTC: nove tabelas, incluindo perfis e fechamento. Não contém senhas ou valores do Vault; não é um backup completo de todo o projeto.
- Ensaio SQL em PostgreSQL embarcado/PGlite: 43 tabelas novas, dados anteriores preservados, 15 identidades mapeadas, RLS, privilégios, enqueue idempotente e claims distintos. Analista de teste vê um cadastro próprio, uma métrica própria e zero métricas legadas alheias. Auth/Vault/Cron/HTTP são simulados; não substitui teste no Supabase hospedado.
- TypeScript, build, 49 testes CX360, 12 testes de integrações, 10 testes de liberação/acesso Chat e cinco testes da entrada Edge passaram. A revisão ampla de lint também deve acompanhar a promoção: o código herdado possui alertas de atualização de estado em efeitos; não considerar lint integral aprovado.

Os backups e relatórios com dados ficam apenas em `output/chat-production-package-20261118` no computador do usuário. Não publicar esses arquivos no Git.

## Escopo e preservação

O SQL adiciona 43 tabelas, 49 funções, três sequências, vínculos e políticas do Chat. Em `profiles`, adiciona somente `chat_analyst_id` opcional; preserva `analyst_id` de Telefone e as políticas existentes de perfis. Restringe cinco políticas de leitura das tabelas legadas do Chat para gestão ou acesso próprio. Não substitui funções compartilhadas, gatilho de workforce, metas, originais, revisões humanas ou fechamentos.

O cadastro dos 15 responsáveis tem correspondência única na produção; não copiar usuários Auth ou UUIDs por suposição. As metas individuais existentes permanecem. `registry-candidate` verifica cada identidade antes de inserir somente o registro oficial de origem.

Não copiar tabelas, filas, auditorias, credenciais ou fechamentos da HML para produção. Outubro e os demais períodos serão capturados novamente pela fonte ClickDesk e publicados somente após conciliação completa. Recebidos vêm do cabeçalho individual ERP/Fiscal; Resolvidos fica separado.

## Ordem de execução após aprovação da release

1. Confirmar que main ainda inclui a base acima e revisar alterações posteriores. Gerar backup atualizado dos objetos/dados afetados e comparar com o inventário; qualquer diferença estrutural exige reavaliar os scripts. Registrar hashes e contagens antes da execução.
2. Manter `CHAT_OFFICIAL_ENABLED` e `NEXT_PUBLIC_CHAT_OFFICIAL_ENABLED` ausentes ou `false`. A entrada servidor também exige `VERCEL_ENV=production` e URL exata do banco de produção. Preview não pode executar o Chat oficial.
3. Aplicar `schema-candidate-NOT-APPLIED.sql` via `apply_migration`, em uma migração identificada de produção. Aplicar `registry-candidate-NOT-APPLIED.sql` depois. Não executar novamente migrações já registradas sem conferir definições. Validar preservação das nove tabelas, gatilho workforce, funções compartilhadas e acesso atual de Telefone/CX.
4. Provisionar os acessos Chat no Auth de produção pelo fluxo normal de convite/definição de senha. Mapear cada usuário à identidade aprovada por `profiles.chat_analyst_id`; os 13 perfis atuais não possuem esses vínculos. Não solicitar senhas no chat, reutilizar hashes de HML ou alterar `analyst_id` de Telefone. Convites não foram enviados neste preparo.
5. Configurar credenciais da conta ClickDesk de produção no canal seguro de servidor. A definição `credentials-initializer-NOT-APPLIED.sql` é restrita a service_role e cria token interno aleatório; não a invocar com valores em comentários, logs ou mensagens. Se os nomes já existirem no Vault, comparar sem expor os valores e não sobrescrever automaticamente. Não existe bootstrap de conta HML neste candidato.
6. Preparar configuração explícita de deploy Edge para os arquivos em `edge/`: `clickdesk-official-metrics-sync` usa `production-index.ts`, JWT de plataforma desligado e autenticação própria obrigatória por token Vault. As demais entradas conservam sua autenticação e destino rígido. Conferir versões e configuração antes de publicar. Não ativar rotinas de IA ou importadores legados.
7. Fazer uma captura controlada de período fechado com a entrada oficial autenticada e rodar unidades do worker até publicação. Resposta 202 significa somente enfileirado. Verificar checkpoints, paginação, totais do grupo e de cada responsável, votos únicos, período correto, RLS de piloto e preservação. Testar rejeição de token inválido e ambiente incorreto. Só então habilitar as duas agendas de `schedule-candidate-NOT-ACTIVATED.sql`.
8. Capturar Outubro e os recortes necessários na produção, guardar fotografia anterior e reconciliar com a fonte atual. Não transportar números antigos da HML como se fossem uma consulta simultânea. Verificar publicação real disparada pelo cron, não apenas dispatch HTTP.
9. Publicar o código da aplicação mantendo as duas flags desligadas. Confirmar que Telefone, CX360 e o Chat anterior continuam funcionando. Só com banco, captura e contas validados, habilitar as duas flags em produção e realizar novo build, pois a flag pública é compilada no cliente.
10. Conferir em produção gestão e piloto autenticado: totais, filtros, pódio/média, avaliações, conversa, abrir/fechar e ajuda. Se os dias não conciliarem, manter a indicação de conferência; nunca fabricar zero ou forçar soma. Registrar commit, deployment, versões Edge, migrações e evidências da publicação final.

## Reversão

Desligar as duas flags e restaurar a aplicação anterior (`dpl_9UkXjPjXxYXKBNPgc52FpBRhsARS`, ou o novo baseline identificado na execução). Suspender somente os dois novos crons Chat e chamadas manuais ao worker. Preservar tabelas e últimas capturas válidas; não apagar originais ou fechamento.

`rollback-candidate-NOT-APPLIED.sql` restaura as políticas antigas de leitura do Chat, que eram amplas para usuários autenticados. **Antes de restaurar essas políticas, retirar os acessos Chat criados durante a promoção ou manter as políticas mais restritas até revisão.** Desligar apenas a tela não revoga acesso direto ao banco. Não executar esse rollback como rotina cega.

As tabelas novas e a coluna opcional podem permanecer sem uso. Não restaurar todo o projeto Supabase para reverter somente Chat, pois isso afetaria outros módulos. O baseline compartilhado deve ser novamente conferido após qualquer reversão.

## Condições ainda executáveis somente na produção

Este preparo não prova captura no banco de produção, provisionamento de analistas, credenciais, cron real ou UI nova em produção. Esses itens são os passos da release após aprovação, com validação antes da exposição. Nenhuma reanálise CX360 ou envio adicional ao Gemini faz parte desta promoção.

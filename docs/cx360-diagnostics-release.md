# CX 360º — pacote de análise dos atendimentos

Preparado em 09/11/2026. Situação: implementação local pronta para revisão; ativação de produção bloqueada até aprovação específica. A tentativa de aplicar a migração foi rejeitada pela revisão automática antes da execução. Não houve nova publicação, alteração de credenciais nem implantação de agendamento.

Revisado em 10/11/2026 sobre a produção a5ef372, preservando integralmente a restauração Zendesk e o alinhamento dos totais do chat. Nesta rodada, 35 testes, TypeScript, lint dos arquivos CX alterados e compilação Next.js passaram. A revisão automática recusou habilitar CLICKDESK_API_KEY para produção e consultar mensagens reais sem autorização específica; as solicitações de aprovação estão pendentes. Nenhuma migração, processamento real, publicação deste pacote ou alteração de credencial foi executada nesta rodada. O código permanece preparado para revisão; não constitui ativação concluída.

## Entrega proposta

- Importar avaliações negativas reais do ClickDesk, incluindo Neutro, com paginação integral e conferência de contagem.
- Consultar até D-1 em Brasília. Precisão de minuto: respostas do mesmo minuto da nota ou posteriores são descartadas por cautela.
- Preservar o quadro aprovado de 15 pessoas e as exclusões combinadas. Carlos Lemos é alias de Carlos Henrique. Pessoas novas não entram automaticamente no quadro individual.
- Separar análises concluídas, pendentes, inconclusivas, com erro, validadas e rejeitadas. Rejeições são preservadas por versão e retiradas dos padrões ativos.
- Apresentar fato observado, hipótese da nota, impacto possível, condução observada, prática proposta, exemplo de comunicação, critério de acompanhamento e limites.
- Exibir mensagens redigidas que sustentam a leitura e histórico anterior à nota. Anexos não são interpretados. Dados de acesso reconhecidos e padrões de identificadores são omitidos; isso não deve ser confundido com garantia de anonimização perfeita de texto livre.
- Validar ou rejeitar por decisão da gestão e iniciar uma investigação com referência e versão do diagnóstico. Ação de melhoria continua exigindo aprovação no fluxo já existente.
- Reconciliar mudanças da fonte, invalidar análises antigas e controlar processamento concorrente com concessões temporárias. Erros e limites do provedor permanecem visíveis e podem ser retomados.
- Agendamento proposto: diariamente às 6h de Brasília, atualizando os últimos sete dias fechados e retomando pendências de até 62 dias. O ciclo é limitado pelo tempo do servidor; a cobertura não é presumida completa quando sobram pendentes.

## Impacto exato da aprovação solicitada

Projeto de banco: produção `qmetbydkepfdgfqkdkai`.

1. Criar quatro tabelas: `cx360_sources` (vínculos de equipes), `cx360_ratings` (avaliações e leituras), `cx360_sync_runs` (conferência da fonte) e `cx360_reviews` (validações por versão).
2. Acrescentar `diagnostic_id` e `diagnostic_hash` em `cx360_cases`, índices e uma proteção para não reescrever a referência de uma investigação já registrada.
3. Criar rotinas de importação e tomada de trabalho, restritas ao serviço do servidor. Habilitar RLS, permitindo leitura apenas à gestão. As tabelas de diagnóstico não recebem escrita direta do navegador.
4. Mapear as duas equipes antigas para as denominações Especializado / Suporte Fiscal e Suporte ERP nesta área, sem renomear o cadastro histórico global.
5. Habilitar no servidor de produção as credenciais ClickDesk já existentes no projeto (hoje destinadas a preview), usando a configuração segura da Vercel. Usar a integração Google Gemini existente para analisar textos redigidos. Criar um segredo exclusivo para o agendamento, sem expor chaves ao navegador, ao repositório ou aos relatórios.
6. Publicar a aplicação com os novos fluxos e o agendamento diário. Fazer importação inicial de outubro e novembro e conferir cobertura e exclusões antes de considerar a ativação concluída.

Os scripts são aditivos. Não alteram cálculos, créditos, produtividade, CSAT ou pódio. O novo processamento armazena avaliações, histórico redigido e pareceres gerenciais, e pode gerar custo no provedor de IA já utilizado pela aplicação. Não há nova atribuição automática de falha ou decisão disciplinar.

## Validação realizada

- 23 testes de regras, cliente, D-1, elegibilidade, leitura temporal e processamento com fonte/provedor simulados, aprovados.
- 12 testes das integrações existentes, aprovados.
- TypeScript, lint dos arquivos alterados e compilação Next.js aprovados.
- Nova interface exercitada no navegador em demonstração isolada: estado sem sincronização, sincronização simulada, cobertura, abertura do diagnóstico, referências de mensagens, rejeição, validação e encaminhamento sintético.
- Endpoints e formato atual da fonte ClickDesk consultados via MCP. Essa consulta de leitura não substitui a validação completa da importação pelo aplicativo.

Limite: a migração e o processamento com dados reais no ambiente publicado ainda não foram executados. A demonstração usa dados sintéticos e não comprova persistência no banco real nem qualidade factual de pareceres de IA em produção.

## Teste de ativação após aprovação

1. Aplicar `supabase/cx360-diagnostics-production.sql` uma única vez e executar o teste transacional `supabase/tests/cx360-diagnostics-production.sql`, que termina em rollback. Se qualquer verificação falhar, não publicar.
2. Rodar advisors e conferir ACL/RLS: anônimo e analista sem diagnósticos de gestão, funções de importação e processamento exclusivas do servidor, histórico sem escrita direta do cliente.
3. Configurar o servidor, publicar e verificar acesso de gestão e recusa dos demais perfis na interface e nas APIs.
4. Importar outubro. Conferir os controles conhecidos: 310 negativas das filas ERP/Fiscal, 280 no quadro aprovado, sendo 146 do Especializado e 134 do ERP. Se a fonte tiver mudado, documentar diferenças por identificador; não ajustar valores para forçar igualdade.
5. Conferir primeiro um lote pequeno de históricos reais: horário da nota, autoria anterior, qualidade das evidências, dados omitidos e fundamentação da prática proposta. Continuar a fila somente com esses controles funcionando.
6. Validar/rejeitar, conferir histórico por versão, iniciar investigação e concluir o ciclo de ação já existente. Não criar achados reais como mera evidência de teste.
7. Conferir execução diária e registrar cobertura restante, falhas e retomadas. Só chamar a etapa de concluída após verificar o fluxo com dados reais e o agendamento.

## Limites editoriais

Nenhuma política interna foi fornecida até a preparação deste pacote. Sugestões não são tratadas como violações de SLA ou de regra interna. A solicitação de documento de políticas continua aberta. Validação tributária/jurídica, inspeção de anexos e diagnóstico psicológico estão fora do processamento.

Esta entrega não inclui radar em tempo real, chatbot conversacional ou relatórios diários/semanais narrativos. O escopo é a análise rastreável das avaliações e a ligação ao acompanhamento de melhorias. A cadência diária atualiza e processa a fonte em D-1.

## Reversão

Desabilitar o novo agendamento e reimplantar a versão anterior da aplicação. As tabelas aditivas podem permanecer restritas, preservando os registros já produzidos. Não apagar avaliações ou histórico de gestão como procedimento de reversão. Qualquer remoção estrutural deve ter aprovação própria.

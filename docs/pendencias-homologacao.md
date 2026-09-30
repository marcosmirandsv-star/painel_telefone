# Pendências oficiais da homologação

Atualizado em: 30/09/2026
Base: branch `homologacao`
Frente ativa: Central de Performance

Este arquivo é a referência operacional das pendências ainda não encerradas. Itens pausados ficam registrados como fora do escopo ativo para não serem confundidos com dívida de homologação.

## 1. Telefone — revisão final do acesso individual
- [x] Revisar a experiência individual do analista após a reorganização corporativa.
- [x] Confirmar foto, posição/ranking, situação, leitura do período e foco de desenvolvimento.
- [x] Compactar foto, nome e posição no mesmo bloco sem alterar cálculo do pódio.
- [x] Confirmar que o módulo Telefone não exibe timer de ClickDesk, pois sua origem de dados não é a sincronização automática do Chat.
- [ ] Validar visualmente desktop e telas menores no Preview autenticado.

## 2. Chat — sincronização viva do ClickDesk
- [x] Consolidar o ciclo oficial de atualização em 60 minutos.
- [x] Exibir última sincronização, próxima sincronização e contador regressivo nas visões pertinentes de gestão e analista.
- [x] Remover dependência operacional e referências ativas de D-1.
- [x] Recusar explicitamente chamadas D-1 no endpoint legado.
- [x] Confirmar em runtime uma execução automática horária usando somente modo `intraday`.
- [x] Tratar ausência de agenda e sinalizar sincronização atrasada no contador.
- [x] Atualizar documentação congelada para o ciclo 09:00–19:00 BRT, de hora em hora.

## 3. Chat — acabamento visual e navegação
- [x] Organizar menus e submenus hierárquicos/recolhíveis.
- [x] Manter os submenus fora da tela até a expansão da área correspondente.
- [x] Preservar fórmulas e regras já homologadas durante a reorganização.
- [ ] Fazer inspeção visual final de responsividade, densidade e navegação contextual no Preview autenticado.

## 4. IA qualitativa — estabilidade e governança
- [ ] Validar estabilidade real dos provedores/fallbacks de IA sob uso prolongado.
- [x] Confirmar cache e reaproveitamento de análises já persistidas no fluxo implementado.
- [x] Confirmar fluxo de governança `pending -> approved/rejected` no modelo e nas rotas existentes.
- [x] Garantir que consolidações oficiais usem somente evidências aprovadas.
- [ ] Validar end-to-end indisponibilidade do provedor e reanálise sem perda de dados em sessão autenticada.
- [x] Preservar evidências, limitações, confiança e rastreabilidade por ticket.
- [x] Redigir identificadores sensíveis do transcript antes da análise externa.

## 5. Análise 360º da Operação do Chat
- [x] Criar área separada da Visão da operação para evitar poluição visual.
- [x] Restringir a área atual aos perfis de gestão existentes; Analista não acessa a visão completa.
- [x] Respeitar equipe e período selecionados no filtro.
- [x] Exibir funil: atendimentos -> avaliações -> positivas/negativas -> CSAT.
- [x] Permitir abrir a Análise 360º a partir da Visão da operação por ação discreta.
- [x] Colocar todas as negativas ainda não analisadas do filtro na fila de análise, sem limite amostral de 5.
- [x] Processar negativas em lotes técnicos e reutilizar análises persistidas.
- [x] Processar positivas em lotes de até 20 para controlar custo/latência sem impedir cobertura progressiva.
- [x] Consolidar padrões de causa, recorrência, influência humana, controlabilidade e evidências.
- [x] Separar fatores do atendimento, empresa/processo, cliente/externo, mistos e inconclusivos.
- [x] Identificar práticas recorrentes nas positivas.
- [x] Gerar síntese gerencial auditável sem usar uma segunda IA para reinterpretar a primeira.
- [x] Classificar a força da leitura por cobertura: sem cobertura, inicial, parcial ou forte.
- [x] Evitar afirmar causalidade quando houver apenas recorrência/correlação.
- [x] Tornar os tickets que sustentam os padrões navegáveis e abrir sua leitura qualitativa no próprio 360º.
- [ ] Implementar o papel `Gestor` com vínculo de equipe e aplicar esse escopo em todo o Chat. Hoje o backend possui apenas Master, Coordenadora e Analista; esta é uma pendência estrutural geral, não exclusiva do 360º.

## 6. Testes específicos da Análise 360º
- [x] Validar matematicamente o cenário de controle 545 atendimentos / 171 avaliações / 132 positivas / 39 negativas / CSAT 77,19% / avaliações 31,38%.
- [x] Validar cenário sem negativas.
- [x] Validar poucas negativas e impedir generalização quando a cobertura é inicial.
- [x] Validar grande volume de negativas e estabilidade dos percentuais.
- [x] Validar cobertura forte e recomendação coerente com controlabilidade.
- [x] Validar que `pending` e `rejected` não entram no consolidado oficial.
- [x] Validar rastreabilidade da síntese/padrões até os tickets de origem.
- [x] Limitar a quantidade de IDs/exemplos exibidos por padrão sem perder a contagem total.
- [ ] Validar em sessão autenticada Todas as equipes x equipe específica.
- [ ] Validar visualmente períodos diferentes e competência atual parcial.
- [ ] Validar end-to-end ticket sem transcript suficiente.
- [ ] Validar end-to-end provedor de IA indisponível.
- [ ] Validar tentativa real de acesso ao 360º por usuário sem permissão.

## 7. Fechamento da homologação
- [x] Build completo após as entregas do 360º.
- [x] Suíte de testes automatizados existente.
- [x] Testes novos da lógica 360º.
- [x] Validar cron/Edge Function da sincronização diretamente no Supabase de homologação.
- [x] Conferir que produção/`main` permanece fora das alterações realizadas nesta rodada.
- [x] Atualizar documentação técnica e checklist de pendências.
- [ ] Verificação visual final em Preview autenticado.
- [ ] Verificação de console/erros de runtime dentro da sessão autenticada.
- [ ] Regressão visual final de Telefone e Chat.
- [ ] Validar cenários autenticados pendentes de permissões/filtros/IA.
- [ ] Somente depois dessas validações discutir promoção para `main`.

## Bloqueios/observações conhecidos
- O Preview da Vercel está protegido. A conexão disponível ao assistente não possui autorização para abrir o projeto/time `project-gestao`; por isso nenhuma inspeção visual autenticada é marcada como concluída.
- O papel `Gestor` com escopo por equipe ainda não existe no enum/tabela de perfis da homologação. Criá-lo exige desenho de autorização/RLS para o Chat inteiro, não uma regra isolada do 360º.
- O endpoint técnico da Edge Function ainda se chama `clickdesk-d1-sync` somente por compatibilidade com o cron instalado; o modo D-1 foi desativado e é recusado.

## Fora do escopo ativo
- Módulo Escalas: pausado por decisão de produto enquanto a empresa avalia solução interna. Não tratar como pendência bloqueadora desta homologação.

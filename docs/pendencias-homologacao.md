# Pendências oficiais da homologação

Atualizado em: 30/09/2026
Base: branch `homologacao`
Frente ativa: Central de Performance

Este arquivo é a referência operacional das pendências ainda não encerradas. Itens pausados ficam registrados como fora do escopo ativo para não serem confundidos com dívida de homologação.

## 1. Telefone — revisão final do acesso individual
- [ ] Revisar a experiência individual do analista após a reorganização corporativa.
- [ ] Confirmar foto, posição/ranking, situação, leitura do período, foco de desenvolvimento e responsividade.
- [ ] Confirmar que o módulo Telefone não exibe timer de ClickDesk, pois sua origem de dados não é a sincronização automática do Chat.
- [ ] Validar desktop e telas menores.

## 2. Chat — sincronização viva do ClickDesk
- [ ] Consolidar o ciclo oficial de atualização em 60 minutos.
- [ ] Exibir última sincronização, próxima sincronização e contador regressivo nas visões pertinentes de gestão e analista.
- [ ] Remover dependência operacional e referências de D-1 que tenham ficado obsoletas após a decisão de sincronização horária.
- [ ] Confirmar comportamento quando a agenda/sincronização estiver indisponível ou atrasada.
- [ ] Atualizar documentação congelada que ainda menciona horários antigos, sem alterar produção.

## 3. Chat — acabamento visual e navegação
- [ ] Fazer revisão final da densidade/hierarquia interna após menus e submenus recolhíveis.
- [ ] Confirmar que submenus aparecem somente quando a área é expandida, sem conteúdo solto ou duplicado.
- [ ] Revisar responsividade, estados recolhidos e navegação contextual.
- [ ] Preservar as fórmulas, regras e permissões já homologadas.

## 4. IA qualitativa — estabilidade e governança
- [ ] Validar estabilidade dos provedores/fallbacks de IA.
- [ ] Confirmar cache e reaproveitamento de análises já persistidas.
- [ ] Confirmar fluxo `pending -> approved/rejected`.
- [ ] Garantir que consolidações gerenciais usem somente evidências aprovadas.
- [ ] Validar erros, indisponibilidade do provedor e reanálise sem perda de dados.
- [ ] Preservar evidências, limitações, confiança e rastreabilidade por ticket.

## 5. Nova frente — Análise 360º da Operação do Chat
- [ ] Criar área exclusiva da gestão; não expor no acesso individual do analista.
- [ ] A entrada deve respeitar equipe e período selecionados na operação.
- [ ] Exibir funil: atendimentos totais -> avaliações -> positivas/negativas -> CSAT.
- [ ] Permitir partir da Visão da operação para a Análise 360º sem poluir a tela operacional.
- [ ] Analisar todas as avaliações negativas elegíveis do filtro, não apenas a amostra de 5.
- [ ] Processar em lotes e persistir resultados para evitar nova cobrança/latência a cada abertura.
- [ ] Consolidar padrões das negativas: causa, recorrência, influência humana, controlabilidade, confiança e evidências.
- [ ] Separar fatores sob controle do atendimento, empresa/processo, cliente/externo e inconclusivos.
- [ ] Analisar também positivas elegíveis para identificar práticas recorrentes que vale preservar/replicar.
- [ ] Gerar síntese gerencial: o que está impactando, o que está funcionando, o que merece ação e o que é contexto.
- [ ] Evitar afirmar causalidade quando houver apenas correlação; usar linguagem proporcional à evidência.
- [ ] Permitir abrir os tickets que sustentam cada padrão.
- [ ] Restringir a visão completa a Master/Coordenador/Gestor conforme escopo de equipe.

## 6. Testes específicos da Análise 360º
- [ ] Todas as equipes x equipe específica.
- [ ] Períodos diferentes e competência atual parcial.
- [ ] Nenhuma negativa.
- [ ] Poucas negativas.
- [ ] Muitas negativas.
- [ ] Cobertura parcial da IA.
- [ ] Ticket sem transcript suficiente.
- [ ] Provedor de IA indisponível.
- [ ] Análise pendente, aprovada e rejeitada.
- [ ] Usuário sem permissão tentando acessar.
- [ ] Conferência do total de tickets usados na consolidação.
- [ ] Rastreabilidade da síntese até os tickets de origem.

## 7. Fechamento da homologação
- [ ] Build completo.
- [ ] Testes automatizados existentes.
- [ ] Testes novos da lógica 360º.
- [ ] Verificação visual em Preview.
- [ ] Verificação de console/erros de runtime.
- [ ] Regressão de Telefone e Chat.
- [ ] Conferir que produção permanece intocada.
- [ ] Atualizar documentação final e registrar o que foi validado.
- [ ] Somente depois da validação explícita discutir promoção para `main`.

## Fora do escopo ativo
- Módulo Escalas: pausado por decisão de produto enquanto a empresa avalia solução interna. Não tratar como pendência bloqueadora desta homologação.

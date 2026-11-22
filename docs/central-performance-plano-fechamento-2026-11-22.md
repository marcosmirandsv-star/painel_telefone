# Central de Performance — plano consolidado de fechamento

**Referência:** 22/11/2026 · produção: `painel-telefone.vercel.app` · Supabase: `qmetbydkepfdgfqkdkai`.

## Princípio de gestão

**Qualidade é o norte.** Volume indica capacidade e produtividade, não comprova experiência positiva. A Visão 360º deve entregar aprendizado baseado em evidência para cada analista e orientação acionável para a gestão. A nota do cliente não determina, isoladamente, a causa ou responsabilidade pelo resultado.

## 1. Migração e indicadores oficiais — operacional, manter monitorado

- Produção e homologação ativas; PRs #104–#109 já integrados.
- Novembro 1º–22/11: 757 avaliações oficiais, 757 tickets únicos e nenhum voto sem responsável na captura analisada.
- Indicadores do Chat Notas/Chat Outros e RPCs com isolamento por analista foram conciliados para os recortes testados. Não substituir a base oficial por dados históricos ou CX360.
- Validar mensalmente autor final, distribuição por equipe, amostra de avaliações e origem da captura.
- Não alterar senhas, perfis, Telefone ou pontuação de clientes durante auditoria de interface.

## 2. Volume diário do ClickDesk — EM EXECUÇÃO

**Causa:** o relatório fornece fotografia de intervalo e o pipeline diário só considera reconciliado um calendário com todos os analistas e soma equivalente ao mês. Mostrar dias ausentes como 0 ou inventar média por diferença de snapshots seria incorreto.

- 19/11 já capturado oficialmente: 112 recebidos (43 Chat Notas, 69 Chat Outros); 15 analistas.
- 17, 18 e 20/11 solicitados em 22/11 e aguardando publicação pela fila durable do ClickDesk.
- PR #110 prepara rota autorizada e somente leitura para capturas exatas de dias já comprovados, com barras reais e lacunas transparentes.
- **Pendente:** coletar gradualmente dias 1–16, 21–22 e quaisquer que faltem, sem ultrapassar limite de 3 solicitações/minuto, preservando a prioridade da captura mensal.
- **Fechamento:** 22 datas com resultados válidos por analista; conciliar soma e diferenças com o mês. Divergências são investigação, nunca ajuste automático de valor. Só então declarar calendário completo.
- Média/pico exibidos durante preenchimento são explicitamente da **amostra de dias verificados**, não do mês.

## 3. Visão 360º / CX — RÉGUA V3 PREPARADA, ALIMENTAÇÃO PENDENTE

- PR #110 adiciona: estado de desfecho comprovável; esforço do cliente; continuidade IA → humano; validação de resultado; próximo passo; ação para o analista; verificação gerencial; anexos/trechos não inspecionados.
- Evidências e hipóteses não se confundem. Cordialidade não comprova resolução; CSAT não comprova falha humana.
- Exibir orientações para gestão e analista em suas respectivas visões; sem imputar responsabilidade pela avaliação sem prova.
- **Bloqueador:** `clickdesk_final_ticket_ledger`, `clickdesk_360_work_queue` e `clickdesk_qualitative_analyses` ainda sem registros em produção. Verificar fonte da última resposta pública humana, integrar transcrições/evidências e só depois ativar análise automática/retroativa.
- **Fonte de legado:** `cx360_ratings` possui 382 avaliações, 346 análises. Comparadas às fotos oficiais de outubro e novembro, 329 têm correspondência estrita de ID, número, responsável, time, classificação e data; as demais não podem ser importadas silenciosamente. Trata-se de análise antiga sujeita a validação, não de dado oficial da operação.
- **Fechamento:** 360º lista tickets reais, com origem, comprovantes e autorização; testes aprovados com ticket #1141375 (Vanessa) e outros positivos/negativos; modelos V3 geram orientações específicas e gerente pode validar/contestar; visual do analista vê somente os próprios tickets.

## 4. Histórico, comparações e interface — PUBLICADO; TESTE VISUAL AUTENTICADO PENDENTE

- Janeiro–setembro preservados como histórico Zendesk; outubro importado parcialmente não é período de comparação; outubro/novembro oficiais ClickDesk em trilha separada.
- PRs #108 e #109 modernizaram cabeçalho, períodos, gráfico histórico e estado de cobertura diária.
- Revisar em Chrome desktop e mobile com sessão real: sobreposições, contrastes, menus, gráficos, erro na página, rolagem e textos.
- **Fechamento:** todas as seções usam rótulos legíveis, filtros funcionam e nenhuma métrica aparece como 0 se sua fonte estiver ausente.

## 5. Acessos e avaliação de CX — validação gradual

- Thiago e Igor: login e vínculo individual confirmados; a consulta do período testado limitou corretamente as linhas ao próprio analista.
- Demais convites: somente após teste de isolamento na UI, API e banco; não disparar em lote sem confirmação gerencial.
- 143 avaliações neutras (111 outubro, 32 novembro) aguardavam classificação na auditoria anterior; consultar o estado atualizado antes de mudar qualquer regra de CSAT.
- **Fechamento:** 15 usuários com funções corretas, acesso apenas aos próprios dados; gestão vê ambos os times; Telefone permanece isolado.

## Próxima ordem de execução

1. Validar e publicar PR #110 em Preview; confirmar proteção da nova API diária e a apresentação do coaching V3.
2. Acompanhar 17/18/20 e solicitar demais datas por lotes controlados, com conciliação real do mês.
3. Projetar e testar ingestão do ledger de último autor humano e transcrições; recuperar 329 análises antigas somente onde a identidade e a nota ainda coincidam.
4. Reexecutar análise qualitativa do ticket Vanessa e outros exemplos com régua V3, auditar anexos e permitir contestação gerencial.
5. Revisão visual e gramatical autenticada, segurança dos 15 acessos, qualidade de amostragem/CSAT e encerramento documentado.

**Invariantes:** não inventar horário, autoria, classificação, motivo da nota, dado diário, resultado do teste ou comportamento do cliente; preservar rastreabilidade; no máximo um responsável humano final por ticket; aprendizes fora dos indicadores; telefone não entra no Chat.

## Revisão da experiência e navegação (22/11/2026)

Auditoria separada de todas as telas de gestão/analista, Telefone, Chat, Férias, Sistema e Fechamentos: [Auditoria visual e funcional](./central-performance-auditoria-ux-funcional-2026-11-22.md).

Principais critérios: menu hierárquico com ícones, objetivo e ajuda de campo em cada módulo; segurança dos perfis; teste autenticado em navegador. Importante: o endpoint legado de Fechamentos do Chat lê a base importada Zendesk e não pode aprovar outubro/novembro de 2026 como ClickDesk oficial. A repaginação não encerra automaticamente as pendências de dados diários ou do inventário 360º.

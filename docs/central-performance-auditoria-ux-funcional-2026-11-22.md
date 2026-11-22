# Central de Performance — auditoria de telas, navegação e funcionalidades

**Data da análise:** 22/11/2026  
**Repositório:** `marcosmirandsv-star/painel_telefone`  
**Produção:** `https://painel-telefone.vercel.app`  
**Escopo desta revisão:** / (Telefone e Sistema), /chat (gestor e analista), /ferias, /integracoes e /gestao-inteligente.

## Objetivo

Revisar módulo por módulo a experiência de navegação para gestores e analistas, preservando a métrica oficial e os dados sensíveis. A interface deve ser moderna, com disposição lateral, ícones indicativos, grupos recolhíveis, propósito explícito de cada tela e ajuda objetiva sobre campos. A IA 360º deve orientar a gestão e o analista com evidências — não substituir a validação humana ou atribuir culpa por nota isolada.

## Alterações implementadas nesta branch

1. **Chat · Gestão:** oito opções da faixa horizontal substituídas por navegação lateral agrupada (Operação, Equipe e produtividade, Visão 360º, Gestão e ações, Pódio, Relatórios, Importar histórico, Cadastros do Chat); cada área apresenta objetivo, passos, significados e limites.
2. **Chat · Analista:** menu restrito a Meu resultado, Minhas avaliações, Meus dias e Minha evolução; âncoras reais para cada seção; ajuda própria explicando competência, período, CSAT e avaliação.
3. **Telefone:** mesma identidade visual e menus agrupados; toda leitura continua distinta do Chat. Itens de Telefone: Painel, Relatórios, Lançamentos, Analistas, Metas e Fechamentos.
4. **Sistema:** Usuários e acessos separados do menu do Telefone, por exigência anterior de arquitetura; não mistura cadastro de profissional com autorização de login.
5. **Férias e capacidade:** navegação lateral para Histórico, Planejamento e Pessoas; ajuda sobre dias corridos, sobreposições, estados e fonte Gente Gestão; erro de consulta de rede tratado sem deixar o botão eternamente carregando.
6. **Fechamentos:** visual e guia atualizados, sem oferecer confirmação de aprovação para resultado já fechado. Bloqueio do canal Chat a partir de outubro de 2026 no fluxo legado: a origem desse endpoint é `chat_monthly_metrics` do Zendesk, não ClickDesk oficial. Nenhum dado histórico foi modificado.
7. **Entrada:** conta vinculada apenas ao Chat deixa de cair em painel telefônico vazio; passa a ter acesso direto à área pessoal do Chat.
8. **Navegação:** ícones vetoriais internos sem dependência nova; grupos recolhíveis, indicadores de seleção e URL `?view=` que preserva a área gerencial do Chat após recarregar.
9. **Metadados:** título e descrição da Central em português, sem texto padrão do Next.js.

## Matriz de revisão por módulo

| Tela/módulo | Papel | Finalidade / principais ações | O que foi verificado | O que falta comprovar em navegação autenticada |
|---|---|---|---|---|
| Entrada / recuperação de senha | Ambos | Login Supabase, recuperação e convite | Fluxos de código preservados; cópias de orientação revisadas | Login/convite/recuperação real em cada perfil |
| Central / áreas de trabalho | Gestão | Escolher Telefone, Chat, Férias ou Sistema | Rotas e gatilhos de menu conferidos no código; nova orientação | Responsividade e ordem visual em desktop/mobile |
| Telefone · painel | Gestor/analista | Resultados manuais de chamadas e CSAT | Permissões e origem manual preservadas no código | Todos os filtros e gráficos com a sessão correspondente |
| Telefone · relatórios | Gestão | Histórico, comparação e feedback | Controle de acesso e componentes inspecionados | Exportações e leituras em dados reais |
| Telefone · lançamentos | Gestão | Registro semanal e evidências | Formulários/handlers mantidos; ajuda adicionada | Salvar, corrigir e tratar erro de validação (sem produzir dados fictícios) |
| Telefone · analistas | Gestão | Cadastro e fotos | Ações preservadas e isoladas do Chat | Validação de edição, upload e exclusão |
| Telefone · metas | Gestão | Parâmetros e referências | Componentes existentes preservados | Efeito real de atualização nos relatórios |
| Sistema · usuários | Gestão | Conta, função e vínculo | Menu movido do Telefone, sem mudança de backend | Convite/cadastro e isolamento de novos usuários |
| Chat · Operação | Gestão | CSAT, volume, avaliações, histórico | Contratos API e estados de carregamento lidos; filtro e guias preparados | Série diária completa ainda depende de capturas conciliadas |
| Chat · Equipe | Gestão | Comparar pessoas e volume por lotação | Filtros e consultas por equipe inspecionados | Testar todos os períodos, equipes e estado vazio |
| Chat · Visão 360º | Gestão | Diagnóstico baseado em evidências | Tela existente e nova orientação de CX analisadas | Inventário por ticket / worker ainda devem ter cobertura comprovada |
| Chat · Gestão e ações | Gestão | Feedback e decisões | Fluxos de validação disponíveis no código | Teste de criação e revisão com tickets reais |
| Chat · Pódio | Gestão | Reconhecimento com elegibilidade | Explicações de 90% CSAT, 25% avaliações e média | Conferência em competência fechada e exceções |
| Chat · Relatórios | Gestão | Word, síntese e histórico | Componentes exportadores e origem identificados | Exportação autenticada e leitura sem sobreposições |
| Chat · Importar histórico | Gestão | Zendesk anterior | Interface de arquivos e exclusão inspecionada | Importação controlada com arquivos de teste não destrutivos |
| Chat · Cadastros | Gestão | Times, profissionais, metas e fotos | Fluxos existentes mantidos, explicação separada de Sistema | Salvar e visualizar mudanças com gestor |
| Chat · Meu resultado | Analista | CSAT e meta próprios | Trilha de dados isolada por RLS (teste abaixo) | Conferir período, metas e estado de fonte pendente com sessão real |
| Chat · Minhas avaliações | Analista | Lista de avaliações e orientação por ticket | API e cláusula por ID de analista revisadas | Abrir tickets, paginação, análise e confidencialidade em navegador |
| Chat · Meus dias | Analista | Seleção por dia | Código e âncora verificados | Provar dados reais de dias com captura disponível |
| Chat · Minha evolução | Analista | Histórico e progresso individual | Comparação ClickDesk/legado separada no código | Navegar/filtrar várias competências |
| Férias · Períodos e histórico | Gestão | Estados e consulta externa | Código de filtro/consulta revisado, erro de rede tratado | Testar resposta real do Gente Gestão configurado |
| Férias · Planejamento e cobertura | Gestão | Programar, detectar sobreposições | Datas inclusivas e sobreposição verificadas em código | Gravar/editar período de teste e conferir autorização de RH |
| Férias · Pessoas e times | Gestão | Atualizar lotação e gestores | RLS gerencial verificada, escrita não executada | Salvar cadastro controlado e auditar histórico de lotação |
| Fechamentos | Gestão | Consultar e preservar competência | Origem legacy identificada; bloqueio pós-09/2026; token de conferência no backend | Testar consulta antiga, aprovação em período encerrado e API |
| Gestão Inteligente antiga | Gestão | Redirecionamento para módulo atual | Não há segundo painel independente; rota redirecionadora | Verificar o acesso a partir de favoritos antigos |

## Evidência de segurança — produção

- Simulação de contexto RLS de **Thiago Reis**: 1 registro de analista visível; 96 avaliações oficiais na fotografia de novembro; 1 único `analyst_id` na amostra; 0 avaliações do acervo gerencial CX360.
- Simulação de contexto RLS de **Igor Siqueira**: 1 registro de analista visível; 56 avaliações oficiais no mesmo recorte; 1 único `analyst_id`; 0 avaliações do acervo gerencial.
- `workforce_people`, `workforce_teams` e `vacation_periods` têm RLS habilitada e políticas de leitura exclusiva da gestão.
- `integration_closures` não concede SELECT diretamente ao papel `authenticated`; o acesso gerencial é via API autorizada.
- As simulações de RLS não substituem teste ponta a ponta de login e UI no navegador.

## Pendências funcionais fora desta alteração visual

1. **ClickDesk diário:** capturas e conciliação integral de 1 a 22/11 ainda em processamento; não inventar pontos para dias ausentes.
2. **Visão 360º automática:** o inventário `clickdesk_final_ticket_ledger` e a fila do worker permaneciam vazios na auditoria de 22/11. A régua CX v3 está incorporada, mas exige dados completos e avaliação real.
3. **Acervo CX360 anterior:** 346 análises, das quais 329 associavam-se de modo estrito a dados oficiais de outubro/novembro na verificação anterior. Não migrar as divergentes automaticamente; nenhuma avaliação/CSAT deve mudar por reutilização de análise.
4. **Fechamento ClickDesk:** deve ocorrer no próprio fluxo oficial do Chat. O endpoint `/api/integrations/closures` é LEGADO para Chat, impedido a partir de outubro/2026.
5. **Testes de navegador autenticado:** revisão final de menus, contraste, gráficos, rolagem, links, operações de gravação e estados de erro em Chrome desktop e mobile. A compilação de Preview confirma integridade do código, não todos os fluxos de trabalho.
6. **Escalas externas:** a escala HTML de Telefone é uma aplicação independente; não integra este repositório e necessita auditoria separada.

## Critérios de aceite da repaginação

- A gestão encontra as funções em até dois níveis: área → tarefa; grupos podem recolher e os itens têm ícones coerentes.
- Analistas veem apenas seus indicadores e opções individuais; não há menu coletivo, nem acesso gerencial via API.
- Cada módulo apresenta título, objetivo, como usar e explicação dos campos principais, sem textos de preenchimento sem significado.
- Filtros indicam o período e a fonte usados. Ausência de dados não é mostrada como desempenho zero.
- Gráficos legíveis, sem sobreposições de rótulos em desktop e dispositivos menores.
- Exportações, fechamentos, cadastros e ações destrutivas preservam suas regras e exigem validação; a repaginação não reescreve indicadores.
- Auditoria final só será marcada como **concluída** após navegação autenticada e verificação do efeito das principais ações.

**Referência de projeto:** `docs/central-performance-plano-fechamento-2026-11-22.md`. Esta revisão de UX não substitui o fechamento técnico nem o inventário 360º.

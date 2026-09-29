# Chat 2.0 — congelamento funcional da arquitetura

Status: homologação  
Data de referência: 29/09/2026  
Branch oficial: `homologacao`

Este documento congela a arquitetura funcional do módulo Chat antes da revisão visual corporativa.

O objetivo do congelamento é separar duas frentes:

1. **comportamento do produto**, já validado funcionalmente;
2. **roupagem visual**, que pode evoluir sem alterar regras, cálculos ou governança.

## 1. Navegação principal congelada

O módulo Chat possui quatro áreas operacionais principais e um agrupador de ferramentas:

### Visão da operação
Responde: **como está a operação agora?**

Deve manter:
- base viva do ClickDesk;
- atendimentos da competência;
- atendimentos do dia;
- CSAT;
- percentual de avaliações;
- positivas e negativas;
- comparação com competência anterior quando houver base comparável;
- leitura operacional e alertas objetivos;
- histórico legado identificado separadamente quando exibido.

### Equipe e produtividade
Responde: **como está o time e cada analista?**

Deve manter:
- visão coletiva;
- visão individual;
- volume;
- CSAT;
- avaliações;
- metas;
- posição/ranking quando aplicável;
- régua diária;
- acesso ao detalhe de tickets avaliados;
- leitura qualitativa individual na régua, sem duplicar uma segunda lista mensal de tickets.

### Gestão e ações
Responde: **onde agir e qual é o próximo passo?**

Deve manter:
- fila de prioridades;
- separação entre qualidade, participação e contexto operacional;
- volume como contexto a validar, nunca como falha automática;
- próxima ação baseada em fatos observáveis;
- fila qualitativa;
- validação humana das leituras;
- consolidação apenas de análises aprovadas.

O plano de gestão e a consolidação detalhada podem ficar recolhidos por padrão. O que exige ação deve permanecer mais visível que o material de consulta.

### Fechamento mensal
Responde: **como consolidar, reconhecer e comunicar o período?**

Deve manter:
- ranking final;
- critérios de elegibilidade;
- pódio;
- ajustes operacionais permitidos;
- relatório individual;
- modelos Coach, MIMO e SARE;
- observações do gestor;
- leitura qualitativa aprovada como contexto opcional do feedback;
- prévia e aprovação do fechamento oficial ClickDesk.

### Ferramentas
Agrupa funções de apoio, não de gestão cotidiana:

- Conferência da base;
- Importação/histórico legado;
- Cadastros;
- Fechamentos oficiais;
- consulta qualitativa de ticket específico quando o ticket não estiver nas amostras gerenciais.

## 2. Fonte de dados

### ClickDesk
É a fonte operacional principal do Chat 2.0.

A base persistida é atualizada automaticamente em homologação:

- 06:10 BRT: reconciliação D-1 e revalidação recente;
- 09:00 BRT: sincronização intradiária;
- 13:00 BRT: sincronização intradiária;
- 17:30 BRT: sincronização intradiária.

As leituras intradiárias usam o próprio dia. A rotina D-1 não deve ser confundida com a atualização do dia corrente.

### Zendesk
Permanece como fonte histórica/legada quando aplicável.

Dados legados devem ser identificados como históricos e não podem ser apresentados como se fossem a fotografia viva do ClickDesk.

## 3. Regras de performance que não podem mudar na revisão visual

### CSAT
Mantém meta individual cadastrada por analista.

### Avaliações
Referência gerencial atual: **25%**.

### Situação individual
A leitura individual continua separando:
- CSAT;
- participação em avaliações;
- volume/contexto.

### Volume
Volume não é usado como culpa automática.

Diferenças relevantes de volume devem gerar **contexto operacional a validar**, considerando, quando aplicável:
- ausência;
- férias;
- treinamento;
- apoio a outra operação;
- empréstimo;
- duração/complexidade dos atendimentos;
- disponibilidade operacional.

### Prioridade gerencial
Qualidade e participação definem prioridade. Volume pode complementar a leitura como contexto.

## 4. IA qualitativa — governança congelada

A IA qualitativa é uma camada horizontal do produto, não um módulo isolado.

### No acesso do analista
O analista pode:
- analisar somente tickets próprios;
- abrir e fechar a leitura de cada ticket;
- consultar uma análise já salva sem gerar novamente;
- receber leitura em linguagem de desenvolvimento.

A leitura individual deve responder, conforme evidência:
- o que aconteceu;
- o que estava sob controle;
- o que vale manter;
- o que pode ser desenvolvido;
- o que precisa ser contextualizado;
- quando não há conclusão segura.

O analista não controla aprovação/rejeição da consolidação.

### Na gestão
A gestão pode:
- analisar tickets;
- revisar a leitura completa;
- aprovar;
- descartar;
- usar ticket específico como consulta excepcional em Ferramentas.

### Estados de governança
- `pending`: análise concluída, aguardando decisão humana;
- `approved`: leitura validada;
- `rejected`: leitura descartada da consolidação.

Fechar/recolher uma leitura **não equivale** a aprovar ou descartar.

### Consolidação
Somente análises `approved` podem alimentar:
- padrões gerenciais;
- contextos validados;
- influência do atendimento humano;
- controlabilidade;
- aprendizados;
- sinais acionáveis;
- contexto qualitativo do feedback/relatório.

Análises `pending` e `rejected` não entram nos padrões.

### Cobertura
Cobertura é a quantidade de avaliações efetivamente analisadas, independentemente da decisão humana.

Deve permanecer explícita para evitar generalizações sobre amostras pequenas.

### Amostragem
Regra congelada para preparação qualitativa:
- até 5 negativas;
- até 5 positivas;
- distribuição ao longo de datas diferentes do período quando houver base suficiente;
- evitar concentrar toda a amostra em um único dia.

## 5. Separação entre gestão e analista

A mesma análise técnica pode alimentar experiências diferentes.

### Gestão
Pode ver:
- sentimento;
- causa;
- influência humana;
- controlabilidade;
- confiança;
- evidências;
- limitações;
- ponto acionável;
- status de validação.

### Analista
Deve receber linguagem mais simples e de desenvolvimento.

Não deve receber controles de governança nem exposição desnecessária de detalhes técnicos do modelo.

## 6. Perfis e escopo

- Master: visão completa;
- Coordenador/Coordenadora: visão gerencial;
- Gestor: própria equipe conforme escopo de acesso;
- Analista: somente visão individual e tickets próprios.

A revisão visual não pode ampliar permissões.

## 7. O que a revisão visual pode alterar

Pode alterar:
- shell corporativo;
- sidebar;
- ícones;
- cabeçalho;
- submenus contextuais;
- ordem visual dentro de uma mesma área;
- densidade;
- espaçamento;
- tipografia;
- componentes de cards;
- tabelas;
- estados recolhidos/expandidos;
- hierarquia visual;
- responsividade;
- linguagem auxiliar, quando não mudar significado operacional.

## 8. O que a revisão visual não pode alterar sem aprovação explícita

Não alterar:
- fórmulas;
- metas;
- regras de prioridade;
- elegibilidade;
- ranking;
- pódio;
- regra de volume;
- regras de amostragem qualitativa;
- estados de validação;
- quem pode aprovar/descartar;
- fonte de dados;
- horários de sincronização;
- regras de fechamento oficial;
- estruturas persistidas no banco;
- permissões;
- comportamento de produção.

## 9. Regra de arquitetura congelada

A partir deste congelamento:

- não criar novos menus principais sem necessidade funcional comprovada;
- não duplicar a mesma ação em duas áreas;
- ações cotidianas ficam nas áreas principais;
- ferramentas excepcionais ficam em Ferramentas;
- consulta fica recolhida quando não exige ação imediata;
- a nova UI deve acomodar a arquitetura existente, não reinventá-la.

## 10. Próxima fase

Próxima fase aprovada para homologação:

**revisão visual corporativa do sistema**, com shell inspirado na experiência corporativa do ClickDesk, sem copiar identidade de terceiros e sem alterar as regras congeladas neste documento.

Produção (`main`) permanece intocada até validação explícita da homologação.

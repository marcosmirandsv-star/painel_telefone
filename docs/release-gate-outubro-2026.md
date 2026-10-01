# Gate de release — Central de Performance Outubro/2026

Atualizado em: 30/09/2026
Escopo ativo: Telefone + Chat + Análise 360º + acesso individual
Fora do escopo: módulo Escalas (pausado por decisão de produto)

## Objetivo

Chegar à apresentação com uma homologação estável, auditável e com caminho claro de promoção para produção, sem carregar funcionalidades pausadas ou permissões incompletas.

## Critérios obrigatórios antes da apresentação

### 1. Análise 360º
- [x] Universo de negativas usa todas as avaliações negativas do filtro.
- [x] Aprovadas são reaproveitadas sem novo processamento.
- [x] Pendentes são reaproveitadas no diagnóstico.
- [x] Rejeitadas são realmente reanalisadas.
- [x] Nunca analisadas entram na fila.
- [x] Síntese usa a base não rejeitada do recorte e não fica limitada às aprovadas.
- [x] Síntese é diagnóstica, sem recomendar estratégia.
- [ ] Executar em sessão real a leitura até 100% das negativas da competência.
- [ ] Conferir se o total final exibido corresponde ao universo real do período.
- [ ] Abrir evidências de alguns padrões e confirmar aderência da classificação.
- [ ] Repetir Todas as equipes x Chat Notas x Chat Outros.

### 2. Acesso individual do Chat
- [x] Karolyne Moreira possui acesso individual ativo na homologação.
- [x] Vanessa Kateline da Silva foi identificada como Vanessa Silva no cadastro ClickDesk.
- [ ] Confirmar o e-mail corporativo exato da Vanessa antes de criar acesso.
- [ ] Criar o acesso da Vanessa vinculado ao analyst_id correto.
- [ ] Rodar roteiro de piloto com Karolyne Moreira.
- [ ] Rodar roteiro de piloto com Vanessa Kateline da Silva.
- [ ] Opcional: segundo piloto adicional do time da Polyana — candidato técnico Maycon Oliveira; confirmar e-mail antes de provisionar.

### 3. Isolamento e permissão
- [x] Teste automatizado separa gestão de Analista.
- [ ] Confirmar em sessão real que Analista não acessa 360º, gestão, cadastros ou dados de outra pessoa.
- [ ] Confirmar em sessão real que cada piloto vê somente seus próprios tickets/métricas.
- [ ] Decidir se o papel Gestor com escopo por equipe é requisito da primeira produção ou fase seguinte. Não promover uma implementação parcial.

### 4. Telefone
- [x] Lógica e reorganização da homologação preservadas.
- [ ] Validar visualmente o acesso individual em desktop.
- [ ] Validar visualmente em tela menor.
- [ ] Confirmar ausência de dependência/timer do ClickDesk no Telefone.

### 5. Chat
- [x] Navegação hierárquica e menus reorganizados.
- [x] Sincronização ClickDesk em ciclo de 60 minutos.
- [x] Última atualização/próxima atualização/contador implementados.
- [ ] Validar responsividade e densidade visual final.
- [ ] Confirmar ausência de erros de console/runtime na sessão autenticada.

### 6. IA qualitativa
- [x] Fallback entre provedores coberto por teste.
- [x] Transcript insuficiente coberto por teste.
- [x] Rejeitada deixa de ser reutilizada do cache.
- [ ] Validar em sessão real pelo menos um caso de falha/reprocessamento.
- [ ] Confirmar que ticket sem transcript suficiente falha de forma clara e não contamina o consolidado.

### 7. Segurança
- [x] Hardening de funções privilegiadas aplicado apenas na homologação.
- [x] Produção não recebeu a migração de hardening.
- [ ] Decidir tratamento de chat_legacy_import antes da promoção definitiva.
- [ ] Revisar se proteção contra senhas vazadas será habilitada no Auth.
- [ ] Rodar Security Advisor imediatamente antes da promoção.

## Critérios obrigatórios antes de produção

- [ ] Apresentação aprovada.
- [ ] Checklist visual/autenticado concluído.
- [ ] Pilotos aprovados pelos usuários reais.
- [ ] 360º com cobertura completa das negativas em pelo menos um recorte real.
- [ ] Estratégia de release definida sem módulo Escalas.
- [ ] Banco de produção comparado com homologação para migrations necessárias.
- [ ] Variáveis/segredos de produção conferidos sem copiar valores de homologação.
- [ ] Backup/plano de rollback definido.
- [ ] Pipeline da release verde.
- [ ] Smoke test pós-deploy definido.
- [ ] Somente então promover código e alterações de banco para produção.

## Princípio operacional

Nenhuma afirmação de prontidão será baseada apenas em lembrança ou impressão. Quando houver fonte verificável, confrontar com código, banco, logs, pipeline e teste reproduzível antes de marcar um item como concluído.

# Matriz de promoção — Homologação -> Produção

Atualizado em: 30/09/2026
Escopo ativo: Telefone + Chat + ClickDesk + Análise 360º + acesso individual
Fora do escopo: Escalas

## Princípio

A promoção não deve ser tratada como simples merge de código. A produção ainda não possui toda a infraestrutura persistida do ClickDesk existente na homologação.

Nenhuma mudança listada abaixo deve ser aplicada em produção antes da aprovação da apresentação e do fechamento do checklist de homologação.

## Diferenças confirmadas de banco

### Já existem em homologação e produção
- analysts
- goals
- profiles
- chat_teams
- chat_analysts
- chat_monthly_metrics
- chat_import_history
- chat_podium_manual
- chat_podium_exclusions
- chat_legacy_import
- bucket público analyst-photos

### Existe na homologação e não existe hoje em produção
- clickdesk_chat_area_links
- clickdesk_chat_analyst_links
- clickdesk_chat_attendances
- clickdesk_chat_daily_metrics
- clickdesk_chat_sync_runs
- clickdesk_qualitative_analyses

### profiles
Produção:
- id
- full_name
- role
- analyst_id
- created_at

Homologação acrescenta:
- chat_analyst_id

Esse campo é obrigatório para o acesso individual do Chat e para as políticas de isolamento do analista.

### Funções de banco
Não foram encontradas hoje em produção as funções específicas do ClickDesk/Chat individual, incluindo:
- current_user_chat_analyst_id()
- current_user_chat_team_id()
- RPCs/self-service ClickDesk
- funções relacionadas a fechamento/histórico individual do ClickDesk

O pacote de promoção precisa criar essas funções antes de liberar o acesso individual em produção.

## Enum de perfil

O enum user_role em produção já contém:
- master
- coordenadora
- analista

Portanto, a primeira promoção do acesso individual não exige alteração do enum apenas para Analista.

O papel Gestor com escopo por equipe continua separado e não deve ser incluído parcialmente na primeira publicação.

## Storage

O bucket analyst-photos foi confirmado tanto em homologação quanto em produção e é público nos dois ambientes.

Ainda assim, políticas de escrita/leitura devem ser comparadas antes da promoção se houver alteração de upload no pacote final.

## Pacote de banco necessário para a primeira promoção

A ordem exata deve ser validada novamente no dia da publicação, mas o conjunto ativo inclui, no mínimo:

1. vínculo Chat no perfil:
   - profiles.chat_analyst_id;
   - FK/índices relacionados;
   - helpers current_user_chat_*.

2. persistência ClickDesk:
   - clickdesk_chat_area_links;
   - clickdesk_chat_analyst_links;
   - clickdesk_chat_attendances;
   - clickdesk_chat_daily_metrics;
   - clickdesk_chat_sync_runs;
   - índices, constraints e RLS correspondentes.

3. IA qualitativa:
   - clickdesk_qualitative_analyses;
   - políticas de leitura própria e gestão;
   - políticas de inserção do analista e validação da gestão.

4. acesso individual/self-service:
   - RPCs necessárias ao histórico/pódio individual;
   - RLS de chat_teams, chat_analysts e attendances;
   - rota/backend de criação de usuários com chat_analyst_id.

5. sincronização:
   - Edge Function/cron necessários ao ciclo de 60 minutos;
   - secrets/variáveis do ClickDesk;
   - confirmação de que somente o modo intraday está ativo.

6. fechamento/histórico:
   - estruturas e RPCs utilizadas pelo módulo ativo de Chat, se forem incluídas na primeira release.

## Não promover automaticamente

- qualquer tabela, função, rota ou cron do módulo Escalas;
- homologation_access_allowlist;
- lógica de primeiro acesso exclusiva da homologação;
- banners/flags exclusivos de homologação;
- secrets, URLs ou chaves do projeto de homologação;
- dados de teste;
- validações aprovadas/rejeitadas usadas durante os testes da IA como se fossem histórico de produção.

## Dados

Os dados persistidos na homologação não devem ser copiados cegamente para produção.

Antes da publicação, decidir separadamente:
- cadastros de equipes/analistas que já existem em produção;
- mapeamentos area/assignee do ClickDesk;
- fechamentos oficiais;
- análises qualitativas de teste;
- histórico de sincronização.

Preferência inicial:
- migrar schema/configuração;
- reconstruir dados ClickDesk em produção via sincronização oficial;
- não levar análises qualitativas de teste.

## Aplicação

A branch homologacao está centenas de commits à frente da main e contém histórico de frentes que não pertencem ao escopo atual.

Portanto, a promoção deve usar uma release candidata/revisada, e não um merge cego de homologacao -> main.

## Gate final de banco

Antes de executar qualquer alteração de produção:
- [ ] comparar schema novamente;
- [ ] gerar plano SQL/migrations na ordem correta;
- [ ] revisar RLS e grants;
- [ ] rodar Security Advisor;
- [ ] confirmar secrets/variáveis;
- [ ] definir backup e rollback;
- [ ] aplicar primeiro schema, depois funções/policies, depois Edge Function/cron;
- [ ] executar sincronização inicial ClickDesk;
- [ ] smoke test com gestão;
- [ ] smoke test com um analista piloto;
- [ ] confirmar que produção antiga continua íntegra caso a release precise ser revertida.

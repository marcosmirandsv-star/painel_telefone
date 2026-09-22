# Homologação — Sistema de Performance

Este documento define o ambiente oficial de homologação do Sistema de Performance.

## Ambientes

- `main`: produção.
- `homologacao`: ambiente persistente de validação do sistema inteiro.
- `feature/*` ou branches específicas: desenvolvimento isolado antes de entrar em homologação.
- `homologacao-escala`: branch histórica do desenvolvimento inicial de Escalas. Não é mais o ambiente oficial.
- `homologacao-ui-corporativa`: branch de trabalho da revisão visual iniciada em setembro de 2026.

Fluxo oficial:

```
feature/* -> homologacao -> validação -> main
```

Nenhuma alteração deve chegar à `main` sem passar pela homologação quando afetar comportamento, interface, dados, regras, integrações ou banco.

## Supabase

Produção:

- projeto: `painel-telefone`
- project ref: `qmetbydkepfdgfqkdkai`

Homologação:

- projeto: `painel-telefone-homologacao`
- project ref: `vvtorcvchnqhcredhorv`

O projeto de homologação possui as estruturas de Escalas e, desde 21/09/2026, também as estruturas necessárias para Telefone, Chat, fechamentos e integrações.

### Dados copiados para validação

A homologação recebe uma cópia controlada dos dados operacionais usados para validar cálculos e interface:

- analistas do Telefone;
- metas;
- lançamentos semanais individuais;
- lançamentos semanais da equipe;
- equipes e analistas do Chat;
- indicadores mensais do Chat;
- exclusões manuais de pódio;
- ajustes manuais de pódio do Telefone;
- fechamentos agregados necessários para conferência.

Não copiar para homologação:

- senhas;
- hashes de senha;
- service role;
- tokens;
- chaves de integração;
- histórico de rate limit;
- segredos da Vercel;
- arquivos de evidência da produção.

Os campos de evidência copiados para a homologação devem permanecer nulos.

## Regras de segurança

1. Produção nunca deve usar o Supabase de homologação.
2. Homologação não deve escrever no Supabase de produção.
3. Chaves de integração da produção nunca devem ser copiadas.
4. O ambiente deve exibir identificação visual clara de homologação.
5. Alterações de UI não podem modificar fórmulas ou regras sem uma mudança explicitamente aprovada.
6. Alterações de cálculo devem ter comparação antes/depois e caso de teste.
7. O módulo de Escalas é apenas uma funcionalidade dentro da homologação geral. Ele pode evoluir, ser pausado ou ser descartado sem eliminar o ambiente de homologação.

## Vercel

A branch `homologacao` deve ter um deployment persistente de Preview ou um projeto Vercel próprio.

As variáveis da homologação devem apontar exclusivamente para o Supabase de homologação:

```
NEXT_PUBLIC_SUPABASE_URL=https://vvtorcvchnqhcredhorv.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key da homologação>
SUPABASE_SERVICE_ROLE_KEY=<service role da homologação>
NEXT_PUBLIC_SCHEDULE_SUPABASE_URL=https://vvtorcvchnqhcredhorv.supabase.co
NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY=<publishable key da homologação>
```

A aplicação diferencia Preview de Produção no código e também pelo hostname do deployment. Qualquer Preview `.vercel.app` diferente do domínio oficial `painel-telefone.vercel.app` usa o Supabase de homologação no cliente.

O ranking seguro do Telefone na homologação usa a Edge Function `phone-podium-ranking`, que replica a mesma regra já existente no servidor e valida o JWT do usuário. Assim, o ranking não depende da service role da Vercel e continua preservando a visão individual do analista.

A validação de acesso da análise gerencial também usa a sessão do próprio usuário no Preview. Operações realmente administrativas — criação de usuários por gestor e integrações externas — continuam fechadas sem `HOMOLOGATION_SUPABASE_SERVICE_ROLE_KEY`, evitando que uma Preview reutilize a chave de produção.

Para o primeiro acesso, a homologação possui uma allowlist de e-mails/perfis e um gatilho de criação de perfil. O usuário cria sua própria senha pelo botão “Primeiro acesso na homologação”; não são copiadas senhas nem hashes da produção.

## Critério de promoção para produção

Antes de `homologacao -> main`, conferir no mínimo:

### Estrutura
- build concluído;
- testes de integração concluídos;
- testes de Escalas concluídos quando o módulo for afetado;
- nenhuma variável apontando para o ambiente errado.

### Telefone
- nomes iguais à referência;
- CSAT igual à referência;
- avaliações iguais à referência;
- atendimentos iguais à referência;
- performance igual à referência;
- ranking igual à referência;
- elegibilidade igual à referência;
- pódio igual à referência;
- gráficos coerentes com os mesmos dados.

### Chat
- equipes e nomes iguais à referência;
- CSAT igual à referência;
- percentual de avaliações igual à referência;
- percentual sem avaliação igual à referência;
- volumes iguais à referência;
- ranking/elegibilidade iguais à referência;
- pódio igual à referência;
- gráficos coerentes com os mesmos dados.

### UI/UX
- desktop;
- telas menores;
- modo escuro;
- modo claro;
- contraste de status;
- tabelas;
- estados vazios;
- mensagens de erro;
- ausência de delay artificial.

## Regra de rollback

Enquanto uma mudança estiver somente em `feature/*`, basta descartar a branch.

Depois de entrar em `homologacao`, a referência anterior permanece no histórico do Git.

Depois de chegar à produção, qualquer regressão deve ser tratada por revert do PR/commit aprovado ou restauração do deployment anterior, sem apagar histórico.

## Status em 21/09/2026

- branch geral `homologacao`: criada.
- Supabase de homologação: ativo.
- estrutura de Telefone e Chat: criada na homologação.
- base operacional para conferência: copiada sem segredos e sem evidências.
- workflow de CI: ajustado para a branch `homologacao`.
- UI corporativa: incorporada à branch `homologacao`; ainda não foi promovida para produção.
- consistência dos dados de cálculo entre produção e homologação: validada por contagem e assinatura dos registros para Telefone e Chat.
- chaves de integração e histórico de rate limit na homologação: vazios.
- usuários do Supabase Auth de homologação: começam vazios; o primeiro acesso é feito por auto cadastro controlado por allowlist.
- allowlist inicial: 11 acessos correspondentes aos perfis atuais do sistema, sem copiar senha ou hash.
- roteamento do cliente Preview -> Supabase de homologação: implementado por ambiente e hostname.
- ranking do Telefone em Preview: isolado em Edge Function autenticada no Supabase de homologação.
- proteção de rotas administrativas: implementada; sem a service role de homologação elas falham fechadas em vez de reutilizar a produção.
- vínculo da service role de homologação na Vercel: opcional para a validação normal de dashboards; continua necessário somente para operações administrativas específicas e integrações externas.
- teste de conexão ClickDesk: preparado no Chat 2.0 da homologação; usa `CLICKDESK_API_KEY` e `CLICKDESK_ACCOUNT_ID` somente no ambiente Preview e exige novo deployment após alterações nessas variáveis.

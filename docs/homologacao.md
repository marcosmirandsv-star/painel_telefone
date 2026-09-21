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

A conexão atual do ChatGPT com a Vercel não possui autorização para alterar esse escopo. Até a troca das variáveis ser confirmada, nenhum deployment deve ser tratado como homologação completa de escrita.

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
- UI corporativa: permanece em branch de trabalho e deve ser validada dentro da homologação.
- vínculo completo Vercel -> Supabase de homologação: pendente de autorização do escopo da Vercel.

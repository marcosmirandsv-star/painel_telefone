# Plano técnico — perfil Gestor com escopo por equipe no Chat

Atualizado em: 30/09/2026
Ambiente alvo inicial: homologação
Status: desenho técnico concluído; implementação ainda não iniciada

## Objetivo

Criar o papel `Gestor` para o módulo Chat com acesso restrito à própria equipe, preservando:

- `Master`: acesso global.
- `Coordenadora/Coordinator`: acesso global.
- `Gestor`: acesso gerencial somente ao time do Chat ao qual estiver vinculado.
- `Analista`: acesso individual somente aos próprios dados.

O papel Gestor não deve ser adicionado à função global `is_management_user()`, porque essa função também protege recursos fora do Chat. Fazer isso daria ao Gestor poderes globais indevidos.

## Estado atual confirmado na homologação

O enum `public.user_role` contém apenas:

- `master`
- `coordenadora`
- `analista`

A tabela `public.profiles` possui `chat_analyst_id`, mas ainda não possui um vínculo de equipe gerencial.

As políticas do Chat usam majoritariamente `public.is_management_user()`, que hoje representa gestão global.

## Modelo proposto

### Perfil

Adicionar de forma aditiva:

- valor `gestor` ao enum `public.user_role`;
- coluna `chat_team_id uuid null` em `public.profiles`, FK para `public.chat_teams(id)`;
- coluna equivalente em `public.homologation_access_allowlist` para que o vínculo seja preservado no provisionamento.

Regras:

- `gestor` exige `chat_team_id`;
- `analista` continua usando `chat_analyst_id`;
- `master/coordenadora` não precisam de `chat_team_id`.

### Helpers de autorização

Manter `public.is_management_user()` como gestão global.

Criar helpers específicos do Chat:

- `public.is_chat_management_user()`: true para Master/Coordenação e para Gestor com equipe válida.
- `public.current_user_chat_team_id()`: para Gestor usa `profiles.chat_team_id`; para Analista deriva a equipe de `chat_analysts`.
- `public.can_access_chat_team(target_team_id uuid)`: true para gestão global; para Gestor somente quando o time corresponde ao vínculo.
- quando necessário, `public.can_access_chat_analyst(target_analyst_id uuid)`: usa o time do analista para aplicar o mesmo escopo.

Qualquer função `SECURITY DEFINER` criada ou alterada deve ter `EXECUTE` revogado de `PUBLIC/anon` e concedido apenas aos papéis realmente necessários.

## Matriz de acesso pretendida

| Recurso | Master/Coordenação | Gestor | Analista |
| --- | --- | --- | --- |
| Visão da operação | Todas as equipes | Própria equipe | Não |
| Análise 360º | Todas as equipes | Própria equipe | Não |
| Equipe/produtividade | Todas as equipes | Própria equipe | Próprio acesso individual |
| Tickets ClickDesk | Todas as equipes | Própria equipe | Próprios tickets |
| IA qualitativa | Todas as equipes | Própria equipe | Próprios tickets |
| Validação qualitativa | Todas as equipes | Própria equipe | Não |
| Cadastros globais / mapeamentos | Sim | Não por padrão | Não |
| Sincronização global ClickDesk | Sim | Não por padrão | Não |
| Telefone | Conforme regra própria | Não herdar automaticamente | Próprio acesso quando vinculado |

## RLS a revisar

A implantação deve revisar, no mínimo:

- `chat_teams`;
- `chat_analysts`;
- `chat_monthly_metrics`;
- `clickdesk_chat_attendances`;
- `clickdesk_qualitative_analyses`;
- pódio/exclusões do Chat quando houver `team_id` ou vínculo via analista.

Tabelas administrativas sem escopo seguro por equipe, como mapeamentos globais e sincronizações, devem permanecer restritas a Master/Coordenação até existir uma regra explícita.

## APIs

`authorizeClickDeskSessionClient()` deve passar a retornar, além do papel:

- `isManagement`;
- `isGlobalManagement`;
- `chatTeamId` para Gestor;
- `chatAnalystId` para Analista.

Nas rotas gerenciais do Chat:

- Master/Coordenação podem usar `team_id=all` ou qualquer equipe.
- Gestor deve ter o filtro forçado para `chatTeamId`.
- tentativa de informar outra equipe deve retornar 403, não apenas uma lista vazia.
- o 360º deve obedecer ao mesmo escopo das demais telas do Chat.

## Interface

Quando o papel Gestor estiver ativo:

- o seletor de equipe deve mostrar somente a equipe vinculada;
- não oferecer a opção “Todas as equipes” ao Gestor;
- menus administrativos globais que não tenham escopo seguro devem permanecer ocultos;
- o Analista continua sem acesso ao 360º.

## Sequência segura de implantação

1. Criar testes de autorização/escopo por equipe.
2. Adicionar o valor `gestor` ao enum em uma migração isolada.
3. Adicionar `chat_team_id` e helpers em migração posterior.
4. Atualizar RLS e testar allow/deny no banco de homologação.
5. Atualizar backend/Edge Function de criação de usuários.
6. Atualizar interface e filtros.
7. Provisionar apenas usuários de teste como Gestor.
8. Testar Gestor Notas x Gestor Outros x Coordenação x Analista.
9. Rodar Security Advisor e corrigir regressões.
10. Somente após homologação discutir qualquer promoção para produção.

## Critérios de aceite

- Gestor Notas nunca enxerga dados do time Outros.
- Gestor Outros nunca enxerga dados do time Notas.
- Gestor não herda poderes globais do Telefone ou de cadastros administrativos por acidente.
- Coordenação/Master mantêm visão total.
- Analista mantém isolamento individual.
- Tentativas de troca manual de `team_id` são negadas no servidor/RLS.
- 360º, métricas, tickets e IA qualitativa usam o mesmo escopo.
- testes allow/deny e Security Advisor passam antes do fechamento da homologação.

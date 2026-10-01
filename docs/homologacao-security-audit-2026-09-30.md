# Auditoria de segurança — homologação

Data: 30/09/2026
Projeto Supabase: `vvtorcvchnqhcredhorv`
Escopo: leitura e hardening do ambiente de homologação. Produção não foi alterada.

## Correções aplicadas

### Funções SECURITY DEFINER expostas a anon/PUBLIC

Foram removidos grants de `PUBLIC/anon` dos helpers:

- `public.current_user_role()`
- `public.current_user_analyst_id()`
- `public.is_management_user()`

Esses helpers continuam disponíveis para `authenticated`, pois são usados pelas políticas/autorização do painel.

### RPC de lembretes de transporte

`public.process_schedule_transport_reminders(date)` estava executável por `PUBLIC`, `anon` e `authenticated`.

A função é chamada pelo `pg_cron` com:

- agenda: `0 11 * * *`;
- banco: `postgres`;
- usuário: `postgres`;
- comando: `select public.process_schedule_transport_reminders();`.

Foi removido `EXECUTE` de `PUBLIC`, `anon` e `authenticated`. O cron interno permanece executável como `postgres`.

Migração aplicada na homologação:
`harden_security_definer_execute_permissions`.

Script reprodutível:
`supabase/homologation-security-hardening.sql`.

## Avisos revisados e considerados intencionais no estado atual

O Security Advisor ainda aponta algumas funções `SECURITY DEFINER` executáveis por `authenticated`.

### Helpers de identidade/RLS

- `current_user_role()`
- `current_user_analyst_id()`
- `current_user_chat_analyst_id()`
- `current_user_chat_team_id()`
- `is_management_user()`

Elas retornam contexto do próprio usuário e são usadas pela camada de autorização/RLS. A exposição a `anon` foi removida onde existia.

### RPCs individuais do Chat

- `get_clickdesk_self_closed_history()`
- `get_clickdesk_self_podium_context(date,date)`

São RPCs destinadas ao portal individual e derivam o usuário/analista a partir da sessão autenticada.

### Bootstrap do cron ClickDesk

`bootstrap_clickdesk_cron_credentials(text,text)` permanece executável por `authenticated`, mas faz checagem interna de papel e aceita apenas Master/Coordenação antes de acessar Vault/cron.

Esse desenho deve ser reavaliado durante a implantação do papel Gestor, para garantir que Gestor não herde privilégios globais.

## Tabelas com RLS e sem policies

O Advisor informa:

- `homologation_access_allowlist`
- `integration_keys`
- `integration_usage`

A auditoria de grants confirmou que `anon` e `authenticated` não possuem privilégios nessas tabelas. Os grants estão restritos a `service_role`. Portanto, o aviso é informativo no estado atual.

## Pendência crítica: chat_legacy_import

`public.chat_legacy_import` está em schema exposto e com RLS desabilitado.

Situação encontrada:

- 0 registros;
- nenhuma referência encontrada no código do repositório;
- nenhuma view/função do banco encontrada apontando para a tabela;
- grants amplos existentes para `anon` e `authenticated`.

Não foi alterada automaticamente. Antes de qualquer correção, decidir entre:

1. remover a tabela, se estiver definitivamente obsoleta;
2. revogar grants, se precisar ser preservada apenas para administração;
3. habilitar RLS e criar policies explícitas, caso ainda exista consumo por clientes autenticados.

O próprio Security Advisor recomenda não habilitar RLS sem definir as policies necessárias, pois isso pode interromper consumidores existentes.

## Auth

O Security Advisor também informa que a proteção contra senhas vazadas está desabilitada no projeto de homologação.

A alteração não foi realizada nesta rodada porque é uma configuração de autenticação que pode impactar criação/troca de senhas e deve ser tratada como decisão de segurança separada.

## Resultado após hardening

O aviso de `SECURITY DEFINER` executável por `anon` deixou de aparecer.
A RPC `process_schedule_transport_reminders(date)` deixou de aparecer entre funções executáveis por `authenticated`.

Permanecem:
- `chat_legacy_import` sem RLS;
- avisos intencionais/revisáveis de funções `SECURITY DEFINER` para usuários autenticados;
- proteção contra senhas vazadas desabilitada.

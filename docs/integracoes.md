# API de indicadores — versão 1

O painel oferece consultas de indicadores agregados por canal e, no chat, por equipe. Nenhuma resposta externa contém nomes de analistas, notas, evidências ou dados de clientes. A API é para comunicação entre servidores; a credencial não deve ser incluída em páginas ou aplicativos públicos.

## Situação deste painel — 16/09/2026

Ativado em produção em `https://painel-telefone.vercel.app`. O script do banco foi aplicado no projeto `qmetbydkepfdgfqkdkai`, e `INTEGRATION_CLIENTS_JSON` foi cadastrado como segredo de produção na Vercel. A republicação com essa configuração foi concluída.

A credencial `painel-validacao` pertence ao proprietário do painel, permite somente consultas agregadas de telefone e chat e expira em **15/12/2026**. O valor secreto foi guardado no arquivo local `.env.integration-validation`, ignorado pelo Git; não está neste guia nem no repositório remoto. Não foi enviado a nenhuma outra equipe. Cada plataforma futura deverá receber sua própria credencial.

Validação remota executada: consultas mensais dos dois canais e consulta semanal retornaram 200; credenciais ausentes/inválidas e uso de credencial externa na área de gestão retornaram 401; data inválida retornou 400; escrita pela API externa retornou 405. Os totais, avaliações e CSAT de agosto foram comparados com consultas diretas ao banco e coincidiram. O limite de 60 consultas e as restrições de acesso do banco foram testados em transação revertida.

Para repetir a validação com a credencial local: `node --env-file=.env.integration-validation scripts/check-integration.mjs`. O comando não imprime o segredo. As aprovações de fechamentos oficiais continuam sendo uma ação da gestão, após conferência dos números.

## Ativação

### Gerador de chaves no painel

O perfil **Master** pode abrir **Fechamentos > Integrações com outros sistemas > Chaves de acesso**. Informe o nome do sistema destinatário, selecione Telefone/Chat e escolha validade de 30, 90, 180 ou 365 dias. Clique em **Gerar chave** e use **Copiar chave** ou **Copiar instruções de acesso**. A chave completa aparece somente nessa resposta; não é possível recuperá-la depois. Se perder, revogue e gere outra.

Na lista, **Revogar acesso** exige confirmação e bloqueia novas consultas com aquela chave. Consultas que já estavam em andamento podem terminar. As chaves autorizam leitura dos canais escolhidos, incluindo dados atuais e fechamentos oficiais, sem permitir gravações ou aprovação. A permissão é por canal, não por equipe. Não há envio automático ao destinatário.

Para instalar o gerador em outro ambiente, aplique também `supabase/integration-keys.sql`. O banco guarda apenas o hash SHA-256, a identificação parcial, nome, canais, prazo e responsável pela criação/revogação. A leitura e escrita diretas por usuários comuns estão bloqueadas. As rotas administrativas validam a sessão e o perfil Master no servidor. As credenciais antigas configuradas no ambiente continuam funcionando e são administradas por essa configuração; a lista da interface mostra as chaves criadas pelo painel.

### Configuração técnica inicial e credenciais legadas

1. Execute `supabase/integrations.sql` no SQL Editor do Supabase do painel. O script cria fechamentos protegidos e o limite de consultas. As tabelas operacionais existentes, incluindo `chat_podium_exclusions`, precisam estar disponíveis.
2. Confira `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do servidor.
3. Execute `node scripts/create-integration-key.mjs projetos` em ambiente privado. O comando exibe uma credencial aleatória e seu hash SHA-256. Entregue a credencial somente ao responsável pelo sistema consumidor.
4. Cadastre o array gerado em `INTEGRATION_CLIENTS_JSON` no ambiente do servidor. Cada plataforma deve ter um `id` diferente. Ajuste `channels` para `telefone`, `chat` ou ambos, e a validade `expires_at`. Para várias plataformas, combine as entradas em um único array.
5. Publique a aplicação e valide uma consulta autenticada. Sem essa configuração, o acesso externo permanece indisponível. Não há credenciais predefinidas.

Para revogar, remova a entrada e atualize o ambiente da aplicação. Para rotacionar, gere outra credencial e substitua o hash. Nunca distribua a chave administrativa do Supabase. O limite é de 60 requisições por minuto por identificador de plataforma, compartilhado entre instâncias do servidor. A tabela de uso mantém apenas o contador mais recente por plataforma, não um histórico de auditoria.

## Consultas

Todas exigem `Authorization: Bearer SUA_CREDENCIAL`. Use HTTPS em produção. Respostas são JSON e não devem ser armazenadas em cache compartilhado.

| Endereço | Parâmetros |
| --- | --- |
| `/api/v1/indicadores/mensais` | `mes=2026-08`, `canal=telefone` ou `chat`, `equipe=all` ou UUID de equipe do chat, `fonte=atual` ou `oficial` |
| `/api/v1/indicadores/semanais` | `inicio=2026-08-01`, `fim=2026-08-31`; telefone, até 93 dias por consulta |

O responsável pelo painel pode obter o UUID da equipe no cadastro `chat_teams`. O acesso externo nesta versão autoriza canais inteiros, não restringe equipes dentro de um canal. A consulta semanal devolve as semanas encontradas e um resumo do intervalo.

```javascript
const resposta = await fetch(
  `${process.env.PAINEL_URL}/api/v1/indicadores/mensais?mes=2026-08&canal=telefone&fonte=atual`,
  { headers: { Authorization: `Bearer ${process.env.PAINEL_TOKEN}` } }
)
if (!resposta.ok) throw new Error(`Consulta falhou: ${resposta.status}`)
const indicadores = await resposta.json()
```

## Significado dos resultados

- `versao` e `regras`: versão do contrato e das regras de cálculo.
- `consultado_em`: instante da coleta; em um fechamento, permanece o instante da coleta preservada.
- `atualizado_em`: `null` nesta versão. A base atual não fornece uma data confiável de última alteração de todos os registros; o horário da consulta não é tratado como atualização da origem.
- `status`: `parcial` para qualquer consulta atual, mesmo de um mês passado; `fechado` somente para um resultado aprovado pela gestão.
- `tem_dados`: informa se existem registros considerados. Zero não é confundido com ausência: percentuais sem registros ou sem denominador são `null`.
- Percentuais usam escala 0–100 e duas casas decimais, volumes são contagens. Os nomes dos campos estão dentro de `indicadores`.

Telefone: `csat_n1` é ponderado pela quantidade de avaliações, com média simples quando não há avaliações, preservando a regra atual do painel. `performance` é chamadas atendidas / chamadas totais × 100. `percentual_avaliacoes` é avaliações / atendimentos × 100. `csat_geral` é a média simples dos lançamentos preenchidos de CSAT geral. Volumes de chamadas e atendimentos individuais são bases distintas e não devem ser somados.

Chat: `csat`, `percentual_avaliacoes` e `percentual_sem_avaliacao` são médias simples dos indicadores individuais considerados, como no painel; não são taxas recalculadas sobre volumes totais. Exclusões manuais do pódio também retiram registros desses cálculos, reproduzindo o painel. `registros_excluidos` torna essa regra visível.

No telefone, entram integralmente todas as semanas que se sobrepõem ao intervalo. A resposta enumera as semanas incluídas. Uma semana atravessando dois meses pode participar dos dois resumos: **não some resumos mensais para calcular um total anual**. Não há rateio diário, pois a origem é semanal. O chat seleciona o mês importado. Não há inferência automática de completude do mês.

## Fechamento oficial

A gestão acessa **Integrações e fechamentos**, escolhe mês, canal e equipe, confere os indicadores e aprova. Apenas contas `master`, `coordenadora` ou `coordinator` podem consultar a prévia e aprovar. Consumidores externos não podem gravar.

O servidor recalcula os indicadores ao aprovar e compara com a prévia: se houver alteração, exige nova conferência. Só aceita meses encerrados, no fuso de São Paulo, com dados. O fechamento guarda o resultado, horário e responsável. O banco impede atualização e exclusão comuns; a aplicação não oferece substituição de fechamentos. Correções oficiais exigirão uma evolução com revisões, sem apagar o registro original.

Cada fechamento corresponde exatamente a mês + canal + equipe. Aprovar `all` não aprova cada equipe separadamente. Consultar `fonte=oficial` antes da aprovação retorna 404; não há substituição silenciosa por dados parciais. A leitura das tabelas atuais ocorre em múltiplas consultas: faça a conferência e aprovação em uma janela sem edição/importação simultânea. Esta versão não implementa bloqueio transacional das origens.

## Erros e operação

| Código | Significado |
| --- | --- |
| 400 | Parâmetros ou corpo inválidos |
| 401 | Credencial/sessão ausente, inválida ou expirada |
| 403 | Canal ou função não autorizado |
| 404 | Equipe ou fechamento inexistente |
| 409 | Mês aberto, fechamento já existente, ausência ou mudança de dados |
| 422 | Volume da consulta excedido |
| 429 | Limite atingido; aguarde `Retry-After` segundos |
| 503 | Configuração, banco ou serviço indisponível |

As consultas fazem paginação interna e falham quando a base não pode ser lida por completo, em vez de devolver um consolidado truncado. Não são publicados rankings, metas, previsões ou textos de IA nesta versão.

Validação local: `npm run test:integrations` (Node 24), `npm run lint`, `npm run build`. Após ativação, valide credencial válida/inválida/expirada, canal proibido, limite, mês vazio e compare um mês real com o painel. Em uma base de homologação, confira aprovação, rejeição de nova aprovação e permanência do fechamento após editar a origem. O script SQL precisa ser validado e aplicado no projeto de destino; testes locais não substituem essa validação.

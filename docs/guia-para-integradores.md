# Guia de integração
para outras plataformas

Orientações para equipes de projetos, tecnologia e dados que desejam consultar os indicadores de atendimento do painel. Referência da implementação em 16/09/2026.

## 1. O que a integração oferece

Consultas somente de leitura, com resultados agregados de Telefone e Chat em JSON. A plataforma consumidora faz a consulta quando precisar; o painel não envia os dados automaticamente. Não é necessário acessar o Supabase nem usar o login pessoal de um gestor.

| Disponível | Escopo |
| --- | --- |
| Resumo mensal | Telefone e Chat; no Chat, todas as equipes ou uma equipe específica. |
| Consulta semanal | Telefone, com resumo do intervalo e detalhamento por semana. |
| Fechamento oficial | Cópia mensal previamente aprovada pela gestão, para o filtro solicitado. |

## 2. Como solicitar acesso

Solicite ao responsável pelo painel uma credencial exclusiva para sua plataforma. Informe o nome do sistema, a equipe responsável, os canais necessários (Telefone, Chat ou ambos), a finalidade e a frequência prevista de consulta. O responsável fornecerá a credencial, sua validade e, se necessário, o identificador da equipe do Chat.

A credencial identifica a plataforma consumidora. Nesta versão, a permissão é por canal; o filtro de equipe não é uma restrição de acesso. Guarde a credencial no servidor ou no gerenciador de segredos da sua plataforma e envie-a somente no cabeçalho Authorization. Não a coloque em URLs, planilhas compartilhadas ou código público.

## 3. Primeira consulta

Endereço base: https://painel-telefone.vercel.app

```http
GET /api/v1/indicadores/mensais?mes=2026-08&canal=telefone&fonte=atual
Authorization: Bearer <CREDENCIAL_DA_SUA_PLATAFORMA>
Accept: application/json
```

O texto entre sinais < > é apenas uma indicação de onde inserir a credencial recebida. Este documento não contém nenhuma credencial utilizável. O acesso é por HTTPS e a integração deve ocorrer entre servidores.

---

# Endereços e filtros

## Consulta mensal • GET /api/v1/indicadores/mensais

| Parâmetro | Obrigatório | Valores e significado |
| --- | --- | --- |
| mes | Sim | AAAA-MM; anos de 2000 a 2099. Exemplo: 2026-08. |
| canal | Sim | telefone ou chat, em letras minúsculas. |
| equipe | Não | all (padrão) ou UUID de uma equipe do Chat. Telefone aceita apenas all. Solicite o UUID ao responsável pelo painel. |
| fonte | Não | atual (padrão) ou oficial. Recomenda-se informar explicitamente. |

## Dados atuais e resultado oficial

fonte=atual: consulta os registros disponíveis no momento, sem exigir aprovação de fechamento. A resposta tem status="parcial", inclusive em meses passados. Esses números podem mudar após ajustes ou novas importações.

fonte=oficial: consulta exclusivamente um fechamento aprovado. A resposta tem status="fechado". Sem fechamento para o mês, canal e equipe exatos, a API retorna 404; ela não substitui o resultado por dados atuais. Um fechamento de todas as equipes não cria fechamentos separados por equipe.

## Consulta semanal • GET /api/v1/indicadores/semanais

| Parâmetro | Obrigatório | Valores e significado |
| --- | --- | --- |
| inicio | Sim | Data inicial em AAAA-MM-DD. |
| fim | Sim | Data final em AAAA-MM-DD; igual ou posterior ao início. O intervalo pode conter até 93 dias, contando as duas datas. |

Disponível apenas para Telefone. Retorna dados atuais, um resumo do intervalo e os indicadores de cada semana encontrada. Não aceita canal, mes, equipe ou fonte como parâmetros. Não há fechamento semanal oficial nesta versão.

```http
GET /api/v1/indicadores/semanais?inicio=2026-08-01&fim=2026-08-31

GET /api/v1/indicadores/mensais?mes=2026-08&canal=chat&fonte=oficial
```

Parâmetros desconhecidos ou repetidos são rejeitados com 400. Não há paginação a implementar no consumidor: cada resposta contém o consolidado do filtro solicitado.

---

# Como interpretar a resposta

| Campo | Significado |
| --- | --- |
| versao / regras | Versão do contrato e das regras de cálculo; atualmente strings "1". |
| canal / equipe | Canal consultado; equipe como all ou UUID. |
| mes / inicio / fim | Mês e limites solicitados. Na consulta semanal, mes é null. |
| consultado_em | Instante da coleta em ISO 8601. Em um fechamento oficial, preserva o instante da coleta original. |
| atualizado_em | Sempre null nesta versão: não representa a última alteração da origem. |
| status / tem_dados | parcial ou fechado; booleano indicando presença de registros considerados. Não comprova completude do mês. |
| regra_periodo | Telefone: semanas_sobrepostas_integrais. Chat: mes_importado_com_exclusoes_do_painel. |
| indicadores | Objeto com os indicadores do canal, detalhados nas próximas páginas. |
| semanas | Somente Telefone: lista de inicio/fim das semanas incluídas. Na rota semanal, cada item também contém indicadores. |
| fechamento_id / fechado_em | Somente na fonte oficial: identificador e instante de aprovação. |

## Exemplo fictício de resposta mensal do Chat

```json
{
  "versao": "1", "regras": "1", "canal": "chat", "equipe": "all",
  "mes": "2026-08", "inicio": "2026-08-01", "fim": "2026-08-31",
  "consultado_em": "2026-09-16T12:00:00.000Z", "atualizado_em": null,
  "status": "parcial", "tem_dados": true,
  "regra_periodo": "mes_importado_com_exclusoes_do_painel",
  "indicadores": {
    "registros_considerados": 2, "registros_excluidos": 0,
    "atendimentos": 200, "atendimentos_validos": 160,
    "avaliacoes": 40, "avaliacoes_positivas": 36,
    "avaliacoes_negativas": 4, "inativos": 40,
    "csat": 90, "percentual_avaliacoes": 25,
    "percentual_sem_avaliacao": 75
  }
}
```

Percentuais estão na escala de 0 a 100, arredondados a duas casas (o JSON pode omitir zeros finais). Preserve null: significa ausência de base para o cálculo, não desempenho zero. Um mês sem registros pode retornar HTTP 200 com tem_dados=false.

---

# Indicadores do Telefone

| Campo em indicadores | Definição |
| --- | --- |
| registros_individuais | Quantidade de lançamentos individuais considerados. |
| registros_equipe | Quantidade de lançamentos da equipe considerados. |
| atendimentos | Soma dos atendimentos dos registros individuais (total_tickets). |
| avaliacoes | Soma das avaliações dos registros individuais (total_reviews). |
| csat_n1 | CSAT individual consolidado, ponderado pela quantidade de avaliações. Sem avaliações, usa média simples dos CSAT registrados. Sem registros, null. |
| percentual_avaliacoes | Avaliações / atendimentos individuais × 100. Sem atendimentos, null. |
| chamadas_atendidas | Soma das chamadas atendidas nos registros da equipe. |
| chamadas_abandonadas | Soma das chamadas abandonadas nos registros da equipe. Não equivale automaticamente a toda categoria de chamada não atendida. |
| chamadas_totais | Soma das chamadas totais nos registros da equipe. |
| performance | Chamadas atendidas / chamadas totais × 100. Sem chamadas totais positivas, null. |
| csat_geral | Média simples dos lançamentos preenchidos de CSAT geral (N1 + N2). Sem valores preenchidos, null. |

## Atenção ao período das semanas

A API inclui integralmente cada semana que se sobrepõe ao intervalo solicitado: início da semana até o fim do intervalo e fim da semana a partir do início do intervalo. Não há divisão proporcional por dia.

Exemplo: uma semana de 27/07 a 02/08 entra integralmente em uma consulta de agosto. Essa mesma semana pode aparecer também em julho. Por isso, não some resumos mensais para obter um total anual sem tratar essa sobreposição.

## Bases diferentes não devem ser somadas

atendimentos e avaliacoes vêm dos lançamentos individuais; os campos chamadas_* vêm dos lançamentos da equipe. Não some atendimentos a chamadas_atendidas e não trate essas medidas como equivalentes sem validar a definição com a gestão.

csat_n1 e csat_geral representam recortes diferentes. Combine com a área responsável qual deles deve ser exibido no relatório consumidor, mantendo o nome da medida explícito.

---

# Indicadores do Chat

| Campo em indicadores | Definição |
| --- | --- |
| registros_considerados | Quantidade de registros mensais incluídos nos cálculos. |
| registros_excluidos | Quantidade de registros retirados pelas exclusões manuais do painel. |
| atendimentos | Soma de total_tickets dos registros considerados. |
| atendimentos_validos | Soma de valid_tickets dos registros considerados. |
| avaliacoes | Soma da quantidade de avaliações (reviews). |
| avaliacoes_positivas | Soma das avaliações positivas. |
| avaliacoes_negativas | Soma das avaliações negativas. |
| inativos | Soma dos atendimentos classificados como inativos na base importada. |
| csat | Média simples dos valores individuais de CSAT considerados. |
| percentual_avaliacoes | Média simples dos percentuais individuais de avaliações. |
| percentual_sem_avaliacao | Média simples dos valores individuais de sending_percentage, apresentado pelo painel como percentual sem avaliação. |

## Regras que o consumidor precisa preservar

Os três percentuais do Chat são médias simples dos registros individuais, reproduzindo o painel. Não são taxas recalculadas a partir da soma dos volumes. Recalculá-los no sistema consumidor pode produzir números diferentes.

As exclusões manuais aplicadas no painel também retiram registros desses indicadores. A quantidade excluída aparece em registros_excluidos. Sem registros considerados, os percentuais retornam null.

A seleção usa o mês importado. Não presuma que atendimentos_validos representa "atendimentos efetivamente realizados", nem que atendimentos representa todos os contatos recebidos, sem confirmar as definições da origem com a gestão.

## Informações não oferecidas nesta versão

Tempo médio de atendimento (TMA) não é disponibilizado pela API atual: não há campo para essa medida na resposta. Não preencha esse indicador com zero nem tente derivá-lo apenas das contagens. Rankings, pódio, metas, previsões e textos de IA também não fazem parte dessas consultas.

A resposta externa não inclui nomes ou identificadores de analistas, dados de clientes, observações individuais nem links de evidências.

---

# Exemplo de implementação

Exemplo em JavaScript para um ambiente de servidor com fetch disponível. Configure PAINEL_TOKEN como segredo da plataforma. Ajuste canal, mês e fonte conforme o uso. O token utilizado por outro sistema é uma credencial de integração, não a sessão de login de um gestor.

```javascript
const base = "https://painel-telefone.vercel.app";
const token = process.env.PAINEL_TOKEN;
if (!token) throw new Error("Configure a credencial da plataforma.");

const filtros = new URLSearchParams({
  mes: "2026-08",
  canal: "telefone",
  equipe: "all",
  fonte: "oficial" // Use "atual" para números ainda não aprovados.
});

const resposta = await fetch(
  `${base}/api/v1/indicadores/mensais?${filtros}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30000),
    redirect: "error"
  }
);

if (!resposta.ok) {
  const detalhe = await resposta.json().catch(() => ({}));
  throw new Error(
    `Consulta falhou (${resposta.status}): ${detalhe.erro ?? "sem detalhe"}`
  );
}

const dados = await resposta.json();
if (!dados.tem_dados) {
  console.log("Sem registros considerados para o período.");
} else {
  console.log(dados.canal, dados.status, dados.indicadores);
}
```

## Operação recomendada

O limite é de 60 consultas por minuto por plataforma, compartilhado entre canais e rotas. Ao receber 429, respeite Retry-After (60 segundos nesta versão). Para falhas transitórias, use tentativas espaçadas e limitadas; não repita indefinidamente erros de credencial ou de parâmetros.

Não faça fallback automático de fonte=oficial para fonte=atual em relatórios oficiais. Exiba o status e o período junto dos indicadores. As respostas usam Cache-Control: no-store; não as exponha em cache público ou compartilhado.

Não há atualização automática em tempo real nem envio por webhook. Defina a frequência de consulta com o responsável pelo painel, conforme a rotina semanal do Telefone e mensal do Chat.

---

# Erros e validação inicial

| HTTP | Significado | Orientação |
| --- | --- | --- |
| 200 | Consulta concluída | Confira tem_dados, status, período e os indicadores. |
| 400 | Parâmetro inválido | Revise formato de datas, canal, equipe e parâmetros repetidos/desconhecidos. |
| 401 | Credencial ausente, inválida ou expirada | Confira o cabeçalho e a validade com o responsável. Não use o login pessoal do painel. |
| 403 | Canal não autorizado | Solicite autorização para o canal necessário. |
| 404 | Equipe ou fechamento não encontrado | Confirme o UUID ou a existência de aprovação para mês + canal + equipe. |
| 405 | Método não permitido | Use GET; a API externa não aprova nem altera registros. |
| 422 | Volume da consulta excedido | Reduza o intervalo semanal ou consulte uma equipe do Chat. Se persistir, acione o responsável. |
| 429 | Limite de consultas atingido | Aguarde o tempo informado em Retry-After. |
| 503 | Serviço ou configuração indisponível | Tente novamente de forma limitada e avise o responsável se persistir. |

## Formato de erro

```json
{ "erro": "Ainda não existe fechamento oficial para este filtro." }
```

Trate primeiro o código HTTP; o texto da mensagem pode variar. Respostas a métodos não suportados e falhas de infraestrutura podem não seguir o formato JSON acima. O código 409 pertence ao fluxo interno de aprovação, não às consultas GET externas.

## Checklist antes de colocar a consulta em uso

1. Receber a credencial própria da plataforma e registrar sua validade.

2. Definir explicitamente canal, período, equipe e fonte atual ou oficial.

3. Comparar uma consulta de referência com o mesmo filtro no painel.

4. Preservar diferenças entre null, zero, ausência de dados e fechamento inexistente.

5. Implementar o tratamento de erros e o limite de consultas.

6. Confirmar as definições das medidas com a gestão antes de montar o relatório.

## Quando precisar de apoio

Encaminhe ao responsável pelo painel o nome da plataforma, a rota e os filtros usados, o horário da tentativa, o código HTTP e a mensagem recebida. Não inclua a credencial, senhas ou o cabeçalho Authorization no chamado.

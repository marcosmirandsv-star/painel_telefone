# Releitura final do coletivo

Uma coleta completa pode falhar porque a origem mudou enquanto os relatórios individuais eram consultados. Após a falha, o sistema faz no máximo duas novas consultas reais ao coletivo. Respeita espera da origem e não renova o prazo original de trinta minutos.

O coletivo relido é registrado em `clickdesk_capture_group_rechecks` com o ID da requisição HTTP, horário, tentativa e resultado. A função trabalha somente com o destino ClickDesk fixo e as credenciais já configuradas no servidor. Não cria ou altera credenciais.

O mesmo montador exige igualdade exata de Recebidos e todos os controles de cadastro, paginação, avaliações únicas e CSAT. Se qualquer controle falhar, a releitura é recusada. Não há tolerância numérica, ajuste de quantidade, remoção de voto ou substituição do payload original.

Se tudo coincidir, uma captura sucessora explícita reutiliza as partes originais intactas e incorpora o novo coletivo. `source_parent_job_id` registra a linhagem; os horários originais das leituras individuais e das páginas de avaliação são preservados. O início da captura sucessora é o mesmo do original, garantindo o limite original de frescor. O publicador SQL existente repete todos os controles antes de atualizar os indicadores.

O job original permanece `failed`. A investigação por IDs e eventos segue independente, com referência à captura sucessora quando houver. Uma nova coleta concorrente ou mais recente impede recuperar a anterior. Leases, token de operação e publicação idempotente impedem duplicação por retry.

Essa etapa não garante sucesso numa origem que continue divergente. Nesse caso, nenhum indicador é publicado e a investigação mantém o resultado que as evidências sustentarem.

## Verificação da coorte por IDs

Se também houver relatórios individuais defasados, a investigação enumera os IDs atuais de cada responsável, valida os filtros, a paginação e a ausência de duplicidade, e relê somente os cabeçalhos individuais cujas quantidades mudaram. Busca novamente todas as páginas de avaliação e, por último, o coletivo. Nenhum valor é calculado para substituir um cabeçalho: os IDs apenas verificam as quantidades efetivamente retornadas pela origem.

A publicação exige que o total de cada cabeçalho individual corresponda aos seus IDs, que a união dos IDs corresponda ao coletivo e que todos os controles existentes de votos e CSAT continuem passando. A prova, as leituras usadas e a linhagem são preservadas em `clickdesk_capture_cohort_proofs`. Há no máximo duas passagens, sem renovar os trinta minutos originais.

Durante uma verificação, o worker reserva a cota de leitura da origem. Uma captura concorrente ainda incompleta é preservada como falha ao ser substituída por uma prova atual validada, impedindo que atualize os indicadores depois. A investigação histórica continua separada e pode permanecer inconclusiva. Nenhuma mensagem é enviada a modelo de IA e nenhum acesso de usuário é criado.

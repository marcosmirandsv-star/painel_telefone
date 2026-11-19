# Releitura final do coletivo

Uma coleta completa pode falhar porque a origem mudou enquanto os relatórios individuais eram consultados. Após a falha, o sistema faz no máximo duas novas consultas reais ao coletivo. Respeita espera da origem e não renova o prazo original de trinta minutos.

O coletivo relido é registrado em `clickdesk_capture_group_rechecks` com o ID da requisição HTTP, horário, tentativa e resultado. A função trabalha somente com o destino ClickDesk fixo e as credenciais já configuradas no servidor. Não cria ou altera credenciais.

O mesmo montador exige igualdade exata de Recebidos e todos os controles de cadastro, paginação, avaliações únicas e CSAT. Se qualquer controle falhar, a releitura é recusada. Não há tolerância numérica, ajuste de quantidade, remoção de voto ou substituição do payload original.

Se tudo coincidir, uma captura sucessora explícita reutiliza as partes originais intactas e incorpora o novo coletivo. `source_parent_job_id` registra a linhagem; os horários originais das leituras individuais e das páginas de avaliação são preservados. O início da captura sucessora é o mesmo do original, garantindo o limite original de frescor. O publicador SQL existente repete todos os controles antes de atualizar os indicadores.

O job original permanece `failed`. A investigação por IDs e eventos segue independente, com referência à captura sucessora quando houver. Uma nova coleta concorrente ou mais recente impede recuperar a anterior. Leases, token de operação e publicação idempotente impedem duplicação por retry.

Essa etapa não garante sucesso numa origem que continue divergente. Nesse caso, nenhum indicador é publicado e a investigação mantém o resultado que as evidências sustentarem.

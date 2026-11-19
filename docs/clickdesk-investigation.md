# Investigação automática de diferenças

Uma captura que falha enfileira uma investigação independente e idempotente. O mesmo worker consulta a fonte em etapas persistidas: enumera IDs técnicos por responsável e data de abertura, verifica a paginação, busca todos os tickets do período alterados desde a primeira consulta (incluindo os que saíram do quadro), recupera os eventos e relê o cabeçalho coletivo.

O diagnóstico reconstrói a situação de fila e responsável nos horários das consultas originais. Só classifica a diferença como explicada quando todos os totais reconstruídos coincidem, a enumeração atual coincide com o cabeçalho atual e os eventos explicam a diferença inteira. O conjunto histórico é uma reconstrução identificada como tal. O número visível e o ID técnico são armazenados separadamente.

Os 90 segundos anteriores ao término de cada unidade representam uma janela em que não há horário atômico da leitura. Mudanças relevantes nessa janela ficam inconclusivas. Paginação truncada, filtro ignorado, IDs repetidos, eventos incompletos, cadeia inconsistente, mudanças durante a investigação e diferenças de período também impedem uma conclusão automática.

HTTP429 respeita o prazo solicitado pela origem. Cada etapa tem lease, proteção contra worker antigo, até cinco tentativas, teto de 150 etapas e duração de duas horas. Há uma investigação ativa por vez. São guardados IDs, canal e eventos de fila, responsável e status; mensagens e dados do cliente não são armazenados. Nenhum modelo de IA é acionado.

O diagnóstico nunca modifica os tickets, os payloads originais ou as métricas publicadas. A captura original continua bloqueada, inclusive quando a diferença é explicada. Uma nova captura deverá passar por todas as proteções existentes antes de publicação. Gestão pode ler o diagnóstico; analistas e anônimos não podem ler a tabela ou executar os RPCs do worker.

Aplicar `supabase/clickdesk-capture-investigations.sql` antes de publicar a nova versão da Edge. A agenda de investigação deve executar somente unidades pendentes, sem criar capturas novas ou ativar a interface Chat. A agenda geral de captura permanece uma decisão separada da liberação da migração.

Validação: `node --experimental-transform-types --test tests/clickdesk-investigation.test.mts`. Inclui regressão do ticket de WhatsApp que saiu de Renovação e entrou no ERP entre a leitura coletiva e a individual, transferências de saída, limites da API, retomada, concorrência e recusa de evidência insuficiente.

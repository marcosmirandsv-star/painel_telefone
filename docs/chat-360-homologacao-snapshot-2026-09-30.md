# Fotografia da homologação — Análise 360º do Chat

Data da conferência: 30/09/2026
Ambiente: Supabase de homologação `vvtorcvchnqhcredhorv`
Origem: `clickdesk_chat_attendances` + `clickdesk_qualitative_analyses`

> Os números abaixo são uma fotografia da rodada. Como o ClickDesk sincroniza de hora em hora, eles podem mudar na próxima conferência.

## Base operacional da competência

| Recorte | Atendimentos | Avaliações | Positivas | Negativas | CSAT | % avaliações |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Todas as equipes | 604 | 182 | 141 | 41 | 77,47% | 30,13% |
| Marcos Miranda - Chat Notas | 281 | 84 | 68 | 16 | 80,95% | 29,89% |
| Polyana Ventura - Chat Outros | 323 | 98 | 73 | 25 | 74,49% | 30,34% |

Conferência matemática:
- 281 + 323 = 604 atendimentos.
- 84 + 98 = 182 avaliações.
- 68 + 73 = 141 positivas.
- 16 + 25 = 41 negativas.

A base de Todas as equipes fecha exatamente com a soma dos dois times.

## Cobertura qualitativa efetiva

Para a fila e a leitura preliminar do 360º, análise efetiva significa `pending` ou `approved`. Leituras `rejected` não entram na leitura e podem voltar para reanálise.

| Recorte | Negativas | Negativas analisadas | Cobertura negativas | Positivas | Positivas analisadas | Cobertura positivas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Todas as equipes | 41 | 13 | 31,71% | 141 | 8 | 5,67% |
| Chat Notas | 16 | 9 | 56,25% | 68 | 4 | 5,88% |
| Chat Outros | 25 | 4 | 16,00% | 73 | 4 | 5,48% |

Na fotografia atual:
- Todas as equipes: 6 negativas aprovadas, 7 pendentes, 8 rejeitadas e 20 nunca analisadas.
- Chat Notas: 5 negativas aprovadas, 4 pendentes e 7 rejeitadas.
- Chat Outros: 1 negativa aprovada, 3 pendentes, 1 rejeitada e 20 nunca analisadas.

## Padrões já observados na base disponível

A amostra ainda é parcial e não deve ser tratada como explicação definitiva da operação.

Nas negativas já válidas aparecem, entre outros:
- expectativa do cliente;
- qualidade da resolução;
- sistema/produto;
- processo;
- tempo de espera.

A controlabilidade também está distribuída entre atendimento, empresa/processo, cliente, fatores mistos e casos inconclusivos. A base atual não sustenta um único fator como explicação universal dos negativos.

Nas positivas já analisadas, `qualidade da resolução` aparece com força no Chat Notas. No Chat Outros a cobertura positiva ainda é muito pequena para uma leitura firme.

## Ponto para a conferência de amanhã

A interface atual possui duas camadas de síntese no backend:
- preliminar: usa análises `pending + approved`;
- validada: usa apenas `approved`.

No frontend, quando existe ao menos uma análise aprovada no recorte, a síntese exibida prioriza a camada validada. Como a quantidade aprovada ainda é pequena, isso pode deixar a leitura muito conservadora/genérica.

Não alterar essa regra antes da conferência manual. Durante a homologação, verificar se:
1. a leitura baseada apenas nas aprovadas representa melhor o que a gestão precisa enxergar; ou
2. o 360º deve usar a base não rejeitada (`pending + approved`) para diagnóstico, mantendo a governança/validação no menu próprio.

## Períodos

A tabela persistida do ClickDesk disponível na homologação contém dados da competência de setembro/2026. Não foi encontrada base equivalente de agosto/2026 em `clickdesk_chat_attendances`; por isso não é válido comparar agosto e setembro no 360º usando fontes diferentes.

## Estado técnico da rodada

- Pipeline da branch `homologacao`: testes + build aprovados.
- Deploy Preview: concluído com sucesso.
- Preview autenticado: inspeção visual ainda depende do acesso ao projeto/time da Vercel.
- Produção/`main`: não alterada por esta rodada.

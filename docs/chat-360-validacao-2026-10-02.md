# Validação da Análise 360º — 02/10/2026

## Escopo

Ambiente: **homologação**  
Produção: **não alterar**

Objetivo: validar o processamento integral das avaliações do ClickDesk e a profundidade da síntese qualitativa do 360º.

## Linha de base capturada em 01/10/2026 à noite

### Setembro/2026

| Equipe | Positivas | Negativas | Positivas analisadas | Negativas analisadas | Pendentes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Marcos Miranda - Chat Notas | 68 | 16 | 4 | 9 | 71 |
| Polyana Ventura - Chat Outros | 73 | 25 | 4 | 4 | 90 |
| Todas as equipes | 141 | 41 | 8 | 13 | 161 |

### Outubro/2026

Outubro é base viva e continuará mudando com novos atendimentos.

| Equipe | Positivas | Negativas | Positivas analisadas | Negativas analisadas | Pendentes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Marcos Miranda - Chat Notas | 36 | 11 | 0 | 0 | 47 |
| Polyana Ventura - Chat Outros | 12 | 6 | 0 | 0 | 18 |
| Todas as equipes | 48 | 17 | 0 | 0 | 65 |

## Roteiro de validação

1. Abrir a homologação e forçar recarga da página (Ctrl+F5).
2. Entrar em **Chat > Análise 360º**.
3. Selecionar **Setembro 2026 > Todas as equipes**.
4. Confirmar que o botão aparece como **Atualizar leitura completa · N pendente(s)** quando houver fila.
5. Acionar o processamento.
6. Confirmar que o botão mostra progresso com quantidade processada e pendente.
7. Aguardar o fim da execução na própria página.
8. Verificar a cobertura final:
   - ideal: 41/41 negativas e 141/141 positivas;
   - se algum ticket não puder ser analisado, a interface deve informar a pendência/falha sem fingir cobertura total.
9. Recarregar a página e confirmar que a cobertura permanece — as análises devem estar persistidas.
10. Abrir a síntese e verificar se fatores como **expectativa do cliente**, **sistema ou produto** ou **qualidade da resolução** vêm acompanhados do conteúdo concreto observado nos tickets.
11. Abrir as evidências de pelo menos um padrão negativo e um positivo e conferir a rastreabilidade dos tickets.
12. Repetir em **Outubro 2026 > Todas as equipes**.
13. Repetir o recorte individual de **Marcos Miranda - Chat Notas** e **Polyana Ventura - Chat Outros** para garantir que a soma por equipe reconcilia com o total.

## Critérios de aprovação

- A fila avança ao clicar em **Atualizar leitura completa**.
- Avaliações já processadas não são duplicadas.
- Rejeitadas podem ser reprocessadas.
- A cobertura persiste após recarregar a página.
- Falhas não são contabilizadas como análises válidas.
- O painel não apresenta cobertura parcial como conclusão consolidada.
- A síntese explica **o que significa o fator predominante**, usando exemplos concretos dos tickets.
- Evidências continuam rastreáveis aos tickets que sustentam cada padrão.
- Nenhuma alteração é feita em produção.

## Observação

Os totais de outubro são dinâmicos. Para validar outubro, compare a fila exibida no momento do teste com a quantidade processada e restante; não use os números desta captura como meta fixa.

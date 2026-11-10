# Conferência do ClickDesk de 1 a 9 de novembro de 2026

Consulta realizada em 10/11/2026 pelo endpoint de relatórios de atendentes, no fuso America/Sao_Paulo. A imagem enviada apresenta a fila Suporte Fiscal. Os oito nomes visíveis e seus números de respondidos, resolvidos, avaliações e satisfação foram conferidos com a API.

| Pessoa na imagem | Respondidos Fiscal | Resolvidos Fiscal | Avaliações Fiscal | CSAT exibido pela fonte |
|---|---:|---:|---:|---:|
| João Pedro Vianey | 230 | 145 | 77 | 96% |
| Thiago Reis | 176 | 106 | 60 | 92% |
| Carlos Henrique | 138 | 70 | 28 | 96% |
| Vanessa Silva | 137 | 94 | 33 | 85% |
| Paulo Victor | 134 | 102 | 43 | 88% |
| Karolyne Moreira | 131 | 84 | 38 | 95% |
| Igor Siqueira | 42 | 30 | 20 | 100% |
| Ana Julia | 12 | 4 | 2 | 100% |

Essas oito linhas visíveis somam 1.100 respondidos, 635 resolvidos e 301 avaliações. Não representam o total da fila inteira: a API também retorna outros participantes. Respondidos não é sinônimo de resolvidos nem de tickets únicos do time.

## Diferenças de escopo

O relatório da fila inclui pessoas de outros times e aprendizes. A performance por equipe da homologação mantém o quadro aprovado de 15 pessoas, exclui Ana Julia e os demais IDs já definidos, usa resolvidos em ERP e Fiscal e agrupa pelo time de lotação. Karolyne e Igor estão cadastrados no time ERP, embora atendam na fila Fiscal. Lorena não está no quadro aprovado dessa integração; o cadastro ativo isolado não revoga essa exclusão.

| Pessoa | Resolvidos Fiscal | Resolvidos ERP | Base consolidada ERP e Fiscal |
|---|---:|---:|---:|
| Carlos Henrique com alias Carlos Lemos | 70 | 5 | 75 |
| Karolyne Moreira | 84 | 11 | 95 |
| Igor Siqueira | 30 | 15 | 45 |

A fotografia persistida da homologação para 01 a 09/11 tem 996 resolvidos no quadro aprovado: 522 no time de Marcos e 474 no time de Polyana. Avaliações são 246 e 173, respectivamente. Nenhum número foi editado para coincidir com a imagem. O CSAT arredondado do relatório não serve para reconstruir contagens exatas de positivas e negativas; a captura existente usa as avaliações individuais.

## Alteração nesta entrega

A conferência da fila é uma consulta GET independente, exclusiva da gestão em homologação, com datas limitadas a D-1 e filas ERP/Fiscal. Mostra a projeção dos indicadores retornados pela API e não escreve no banco, não altera performance, fórmulas ou pódio. As legendas da Central agora distinguem relatório do período e ledger de autoria comprovada. O novo componente só consulta a origem quando o gestor aciona Conferir fonte.

As 317 análises qualitativas encontradas no período continuam pendentes de seleção editorial (297 positivas e 20 negativas). Isso não invalida notas nem bloqueia os indicadores. Não foi realizada aprovação ou rejeição em massa.

Produção não recebe esta entrega. O CX 360º de produção mantém seu processo separado de ativação.

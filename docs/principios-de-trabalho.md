# Princípios de trabalho do projeto

Atualizado em: 30/09/2026

## Regra de verificação

Nenhuma lembrança, hipótese ou interpretação — seja do usuário ou do assistente — deve ser tratada como fato quando houver uma fonte verificável disponível.

Fluxo obrigatório:
1. usar a informação relatada como hipótese/pista;
2. confrontar com código, banco, logs, histórico de execução ou comportamento reproduzível;
3. separar explicitamente fato confirmado, hipótese plausível e ponto ainda não comprovado;
4. quando houver divergência, mostrar a divergência em vez de ajustar a evidência à narrativa;
5. não transformar uma lembrança não confirmada em regra de produto, teste, permissão ou dado oficial.

Exemplo que originou a regra:
- havia 6 avaliações negativas com status `approved`;
- inicialmente foi inferido que eram aprovações dos testes;
- a confirmação posterior no banco mostrou que as 6 realmente foram validadas pelo usuário Marcos Miranda, mas o banco não registra o rótulo da sessão específica de teste;
- conclusão correta: “aprovadas manualmente pelo usuário”, e não “comprovadamente pertencentes ao teste X”.

Esta regra vale para toda a homologação, especialmente indicadores, IA, permissões, sincronização, fechamento e promoção para produção.

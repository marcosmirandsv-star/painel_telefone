# Piloto de acesso individual do Chat — Karolyne e Vanessa

Ambiente: **homologação**  
Objetivo: validar experiência, isolamento de dados e leitura individual antes da liberação para os demais analistas.

## Pilotos

- Karolyne Moreira — Chat Outros / Polyana Ventura.
- Vanessa Silva — Chat Notas / Marcos Miranda.

Ambas devem ter perfil **Analista**, sem vínculo com Telefone e com acesso apenas aos próprios dados do Chat.

## Teste funcional

1. Entrar com o login do piloto.
2. Confirmar que o menu mostra apenas o acesso individual pertinente ao Chat.
3. Confirmar que não aparecem menus gerenciais, Análise 360º da operação, gestão da equipe, cadastros, usuários ou fechamentos.
4. Confirmar que o nome, foto e equipe exibidos pertencem ao próprio analista.
5. Conferir os números do período atual: atendimentos, avaliações, CSAT e metas.
6. Comparar os números do piloto com a visão Master filtrada para o mesmo analista e período.
7. Confirmar que o histórico mensal mostra somente o próprio analista.
8. Confirmar que ranking/pódio mostra somente o contexto permitido ao analista, sem expor dados individuais indevidos de colegas.
9. Tentar navegação direta/URL para áreas gerenciais e confirmar bloqueio.
10. Sair e entrar novamente para confirmar persistência correta da sessão e do vínculo.

## Segurança / isolamento

- O piloto não deve conseguir consultar outro analyst_id por alteração de URL ou requisição.
- O piloto não deve receber dados de outra equipe em respostas de API.
- O perfil não deve conseguir acessar criação de usuários, metas gerenciais, lançamentos ou ferramentas administrativas.
- O login deve continuar restrito à homologação.

## Critério de aprovação

O piloto é aprovado quando:
- números individuais reconciliam com a visão Master;
- nenhuma informação de outro analista fica exposta;
- navegação é simples e sem menus gerenciais;
- os dados principais são compreensíveis sem explicação externa;
- Karolyne e Vanessa conseguem usar o painel sem intervenção técnica.


## Linha de base de outubro — captura técnica

Use estes valores apenas como referência do momento da captura. Outubro é base viva e pode mudar após novas sincronizações.

| Piloto | Equipe | Atendimentos | Avaliações | Positivas | Negativas | CSAT | Cobertura de avaliações |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Karolyne Moreira | Polyana Ventura - Chat Outros | 14 | 2 | 2 | 0 | 100,00% | 14,29% |
| Thiago Reis | Marcos Miranda - Chat Notas | 65 | 15 | 11 | 4 | 73,33% | 23,08% |
| Vanessa Silva | Marcos Miranda - Chat Notas | 59 | 15 | 10 | 5 | 66,67% | 25,42% |

Na validação, compare sempre o portal do piloto com a visão Master filtrada para o mesmo analista e período. Se a base tiver sincronizado depois desta captura, os números podem aumentar; o que deve permanecer igual é a reconciliação entre as duas visões.


## Pré-validação técnica concluída

Antes do início dos pilotos, a homologação passou por uma revisão de isolamento:

- métricas, histórico e tickets rejeitam tentativa de consultar outro `analyst_id`;
- Análise 360º e processamento do 360º são exclusivos da gestão;
- IA qualitativa valida a propriedade do ticket antes de consultar/reutilizar cache;
- o portal individual não usa outro analista como fallback quando o próprio registro não é encontrado;
- `/integracoes` exige gestão e o gerenciamento de chaves exige Master;
- `/escalas` bloqueia Analista antes de carregar qualquer dado;
- tabelas `schedule_*` foram fechadas no RLS para gestão, com privilégios de `anon` revogados;
- políticas de leitura da IA qualitativa limitam Analista ao próprio `chat_analyst_id`.

A validação humana dos pilotos continua necessária para experiência, clareza visual e reconciliação dos números exibidos.

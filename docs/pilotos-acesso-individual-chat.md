# Plano de pilotos — acesso individual do Chat

Data-alvo inicial: 01/10/2026
Ambiente: homologação

## Objetivo

Validar a experiência que será distribuída aos analistas antes da promoção para produção, usando pelo menos um piloto de cada equipe.

## Estado confirmado no banco

### Acesso de analista já existente

O único perfil `analista` confirmado hoje na homologação está vinculado a:
- Karolyne Moreira
- equipe: Polyana Ventura - Chat Outros
- e-mail: karolyne.moreira@clickdigital.com.br

A referência verbal “Caroline Moreira” foi confrontada com o banco. O cadastro real é Karolyne Moreira, com K. Não criar um segundo acesso para “Caroline”.

### Piloto da equipe Marcos

A colaboradora foi confirmada em registros anteriores da operação como:
- Vanessa Kateline da Silva
- no ClickDesk/base persistida aparece de forma abreviada como Vanessa Silva
- equipe: Marcos Miranda - Chat Notas
- ativa
- 44 atendimentos em setembro
- 11 avaliações: 7 positivas e 4 negativas
- sem perfil individual criado hoje

Ainda não foi localizado um e-mail corporativo exato em Auth, profiles, allowlist ou produção. Não inferir o endereço pelo padrão nominal. Confirmar o e-mail antes do provisionamento e vincular o acesso ao analyst_id já confirmado da Vanessa Silva.

### Segundo piloto da equipe Polyana

Candidato técnico sugerido: Maycon Oliveira.
Motivos:
- ativo;
- foto cadastrada;
- 39 atendimentos em setembro;
- 15 avaliações;
- 11 positivas e 4 negativas;
- sem perfil individual criado hoje.

O e-mail corporativo de Maycon não foi confirmado no banco e não deve ser inferido. Confirmar antes de provisionar.

## Roteiro de teste dos pilotos

Para cada piloto:
- login e sessão;
- exibição correta de nome/foto/equipe;
- isolamento individual: não enxergar dados de outro analista;
- atendimentos do mês e do dia;
- CSAT e avaliações;
- metas/status;
- pódio/posição quando elegível;
- histórico;
- leitura qualitativa dos próprios tickets, quando disponível;
- ausência de menus gerenciais/360º;
- comportamento em desktop e tela menor;
- logout/login novamente;
- confirmação de que a sincronização do ClickDesk atualiza o painel sem intervenção manual.

## Critério de aceite

Os dois pilotos devem conseguir usar o painel sem orientação técnica especial, enxergar somente os próprios dados e reconhecer que os números apresentados correspondem ao trabalho real do período.

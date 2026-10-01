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

Não foi encontrado perfil/auth/allowlist com os termos “Caroline” ou “Moderante”. Se “Caroline Moderante” se referia a outra pessoa, confirmar identidade antes de criar qualquer acesso.

### Piloto da equipe Marcos

Foi solicitado preparar acesso para “Vanessa Catelini”, porém a base operacional do Chat contém:
- Vanessa Silva
- equipe: Marcos Miranda - Chat Notas
- ativa
- 44 atendimentos em setembro
- 11 avaliações: 7 positivas e 4 negativas
- sem perfil individual criado hoje

Não foi encontrado “Vanessa Catelini” em Auth, profiles ou homologation_access_allowlist. Confirmar nome/e-mail antes do provisionamento para evitar vínculo incorreto.

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

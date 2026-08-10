# Manual operacional - Sistema de Performance

Este manual orienta o uso do sistema de performance para os modulos Telefone e Chat.

## Acesso

- Producao: https://painel-telefone.vercel.app
- O acesso e feito por e-mail e senha cadastrados no Supabase.
- Se esquecer a senha, use a opcao de recuperacao na tela de login.
- Perfis:
  - Master: acesso completo.
  - Coordenadora: acesso de gestao.
  - Analista: visao individual do telefone.

## Visao geral

O sistema tem dois modulos principais:

- Telefone: acompanhamento semanal, ranking, podio, metas, relatorios SARE e devolutiva assistida por IA.
- Chat: importacao mensal do Zendesk, ranking, podio, ajustes manuais, metas por analista e relatorio individual com IA.

As leituras preditivas do dashboard sao calculadas pelo proprio sistema. A IA externa e usada apenas para apoiar textos de feedback e relatorios.

## Modulo Telefone

### Lancamentos semanais

Use a aba Lancamentos para registrar:

- Lancamento individual do analista.
- Inicio e fim da semana.
- CSAT realizado.
- Total de atendimentos.
- Avaliacoes positivas.
- Avaliacoes five.
- Observacoes, quando houver.
- Evidencia do 55PBX, se necessario.

Tambem registre o desempenho da equipe:

- Ligacoes atendidas.
- Ligacoes abandonadas.
- Total processado.
- Observacoes.
- Evidencia do 55PBX.

### Regra da performance da equipe

A performance da equipe no telefone segue esta formula:

```text
ligacoes atendidas / total processado x 100
```

Exemplo:

```text
1422 / 1467 x 100 = 96,93%
```

### Ranking e podio

O ranking considera:

- CSAT minimo para podio: 90%.
- Percentual minimo de avaliacoes: 25%.
- Volume de atendimentos dentro da media do periodo.
- Meta individual de CSAT cadastrada em cada analista.

O sistema mostra:

- Podio do periodo.
- Ranking completo.
- Motivos de nao elegibilidade.
- Posicao do analista quando ele acessa com perfil individual.

### Relatorio do telefone

Na aba Relatorios:

1. Escolha o periodo.
2. Selecione o analista.
3. Confira se existe lancamento individual e lancamento da equipe.
4. Opcionalmente, escreva observacoes do gestor.
5. Use Gerar sugestao local ou Gerar texto assistido.
6. Revise o texto final.
7. Exporte Word ou salve PDF.

O texto assistido usa IA externa quando disponivel. Se a IA falhar, o sistema usa a sugestao local para nao travar o relatorio.

## Modulo Chat

### Importacao mensal

Use a aba Importacao para carregar as planilhas mensais do Zendesk:

- Planilha de satisfacao.
- Planilha de inatividade.
- Mes e ano correspondentes.

Depois da importacao, confira a aba Base importada antes de analisar ranking ou gerar relatorios.

### Base importada

A aba Base importada mostra:

- Atendidos.
- Inativos.
- Validos.
- Avaliacoes.
- Sem avaliacao.
- CSAT consolidado.

Principais formulas:

```text
% avaliacoes = avaliacoes recebidas / atendimentos validos x 100
```

```text
% sem avaliacao = atendimentos validos sem avaliacao / atendimentos validos x 100
```

```text
% inatividade = inativos / atendimentos totais x 100
```

Para o fechamento, o indicador mais importante e o percentual de envio/sem avaliacao conforme a regra original do painel do chat.

### Ranking e podio do Chat

O ranking mensal do chat considera:

- CSAT minimo: 90%.
- Avaliacoes a partir de 25%.
- Volume acima da media do periodo.
- Excecoes manuais quando houver emprestimo, cobertura ou ajuste operacional.

Na aba Ranking e podio, e possivel:

- Ver ranking completo.
- Ver a media exigida de atendimentos.
- Tirar ou permitir analista no podio.
- Definir manualmente 1o, 2o e 3o lugar.
- Resetar o podio manual.

### Cadastros do Chat

Na aba Cadastros, a gestao pode:

- Incluir analista.
- Editar meta CSAT individual.
- Inativar analista.
- Reativar analista.
- Excluir cadastro criado por engano.

Prefira inativar quando houver historico.

### Relatorio individual do Chat

Na aba Relatorios:

1. Selecione o analista.
2. Escolha o modelo de feedback: Coach, SARE ou MIMO.
3. Escreva observacoes do gestor, se houver.
4. Clique em Gerar sugestao ou Gerar texto assistido.
5. Revise o texto final.
6. Exporte o relatorio individual.

O relatorio traz:

- Dados do ciclo.
- Analise tecnica.
- Evolucao mensal.
- Feedback final para envio ao colaborador.

## Uso da IA

A IA externa apoia textos de feedback e relatorios.

Ela nao substitui os calculos do sistema. Os indicadores, rankings, podios e diagnosticos do dashboard continuam sendo calculados localmente.

Quando usar IA:

- Para melhorar o tom do feedback.
- Para transformar numeros em devolutiva mais humana.
- Para incluir observacoes do gestor de forma mais profissional.
- Para gerar um plano de desenvolvimento mais claro.

Quando nao usar IA:

- Para alterar calculos.
- Para decidir ranking sem conferir os dados.
- Para substituir a revisao do gestor.

## Checklist de fechamento mensal

### Telefone

- Conferir se todas as semanas foram lancadas.
- Conferir lancamento da equipe.
- Validar ranking e podio.
- Gerar relatorios individuais.
- Revisar texto assistido antes de enviar.

### Chat

- Importar planilhas do Zendesk.
- Conferir Base importada.
- Validar media de volume.
- Revisar excecoes de podio.
- Gerar relatorios individuais.
- Revisar texto assistido antes de enviar.

## Boas praticas

- Sempre revise o texto gerado por IA.
- Nunca envie relatorio sem conferir periodo e analista.
- Use observacoes do gestor para contextualizar excecoes.
- Nao exclua analistas com historico; prefira inativar.
- Antes de fechar o mes, confira se os numeros batem com a fonte original.

## Comandos tecnicos uteis

Dentro da pasta do projeto:

```powershell
cd C:\Users\marcos.miranda\Documents\painel_telefone
```

Rodar localmente:

```powershell
npm run dev
```

Validar antes de publicar:

```powershell
npm run build
```

Salvar alteracoes:

```powershell
git add .
git commit -m "mensagem do ajuste"
git push origin main
```


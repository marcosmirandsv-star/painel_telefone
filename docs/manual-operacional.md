# Manual operacional - Sistema de Performance

Este manual orienta o uso do sistema de performance para os módulos Telefone e Chat.

## Acesso

- Producao: https://painel-telefone.vercel.app
- Nome do projeto na Vercel: central-performance
- O acesso e feito por e-mail e senha cadastrados no Supabase.
- Se esquecer a senha, use a opcao de recuperação na tela de login.
- Usuários de gestão podem criar novos acessos na aba Usuários do módulo Telefone.
- Perfis:
  - Master: acesso completo.
  - Coordenadora: acesso de gestão.
  - Analista: visão individual do telefone.

### Criacao de usuários

Use a aba Usuários para criar acesso de novas pessoas:

- Nome completo.
- E-mail.
- Senha temporaria.
- Perfil de acesso.
- Analista vinculado, quando o perfil for Analista.

Por seguranca, a criacao de usuários depende da variavel secreta SUPABASE_SERVICE_ROLE_KEY configurada na Vercel. Esta chave deve ficar apenas nas variaveis de ambiente do servidor e nunca deve ser exibida na tela ou enviada a usuários.

## Visão geral

O sistema tem dois módulos principais:

- Telefone: acompanhamento semanal, ranking, pódio, metas, relatórios SARE e devolutiva assistida por IA.
- Chat: importação mensal do Zendesk, ranking, pódio, ajustes manuais, metas por analista e relatório individual com IA.

As leituras preditivas do dashboard são calculadas pelo proprio sistema. A IA externa e usada apenas para apoiar textos de feedback e relatórios.

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

A performance da equipe no telefone segue está formula:

```text
ligacoes atendidas / total processado x 100
```

Exemplo:

```text
1422 / 1467 x 100 = 96,93%
```

### Ranking e pódio

O ranking considera:

- CSAT mínimo para pódio: 90%.
- Percentual mínimo de avaliações: 25%.
- Volume de atendimentos dentro da média do período.
- Meta individual de CSAT cadastrada em cada analista.

O sistema mostra:

- Podio do período.
- Ranking completo.
- Motivos de não elegibilidade.
- Posicao do analista quando ele acessa com perfil individual.

### Relatorio do telefone

Na aba Relatorios:

1. Escolha o período.
2. Selecione o analista.
3. Confira se existe lançamento individual e lançamento da equipe.
4. Opcionalmente, escreva observacoes do gestor.
5. Use Gerar sugestão local ou Gerar texto assistido.
6. Revise o texto final.
7. Exporte Word ou salve PDF.

O texto assistido usa IA externa quando disponível. Se a IA falhar, o sistema usa a sugestão local para não travar o relatório.

## Modulo Chat

### Importacao mensal

Use a aba Importacao para carregar as planilhas mensais do Zendesk:

- Planilha de satisfacao.
- Planilha de inatividade.
- Mes e ano correspondentes.

Depois da importação, confira a aba Base importada antes de analisar ranking ou gerar relatórios.

### Base importada

A aba Base importada mostra:

- Atendidos.
- Inativos.
- Validos.
- Avaliacoes.
- Sem avaliação.
- CSAT consolidado.

Principais formulas:

```text
% avaliações = avaliações recebidas / atendimentos válidos x 100
```

```text
% sem avaliação = atendimentos válidos sem avaliação / atendimentos válidos x 100
```

```text
% inatividade = inativos / atendimentos totais x 100
```

Para o fechamento, o indicador mais importante e o percentual de envio/sem avaliação conforme a regra original do painel do chat.

### Ranking e pódio do Chat

O ranking mensal do chat considera:

- CSAT mínimo: 90%.
- Avaliacoes a partir de 25%.
- Volume acima da média do período.
- Excecoes manuais quando houver emprestimo, cobertura ou ajuste operacional.

Na aba Ranking e pódio, e possível:

- Ver ranking completo.
- Ver a média exigida de atendimentos.
- Tirar ou permitir analista no pódio.
- Definir manualmente 1o, 2o e 3o lugar.
- Resetar o pódio manual.

### Cadastros do Chat

Na aba Cadastros, a gestão pode:

- Incluir analista.
- Editar meta CSAT individual.
- Inativar analista.
- Reativar analista.
- Excluir cadastro criado por engano.

Prefira inativar quando houver histórico.

### Relatorio individual do Chat

Na aba Relatorios:

1. Selecione o analista.
2. Escolha o modelo de feedback: Coach, MIMO ou SARE.
3. Escreva observacoes do gestor, se houver.
4. Clique em Gerar sugestão ou Gerar texto assistido.
5. Revise o texto final.
6. Exporte o relatório individual.

O relatório traz:

- Dados do ciclo.
- Analise tecnica.
- Evolucao mensal.
- Feedback final para envio ao colaborador.

## Configuracao de produção

Variaveis obrigatorias na Vercel:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
- SUPABASE_SERVICE_ROLE_KEY

Variaveis opcionais/recomendadas:

- GEMINI_API_KEY, para feedback assistido por IA.
- NEXT_PUBLIC_APP_URL, para links de recuperação de senha. Use o dominio de produção: https://painel-telefone.vercel.app
- GITHUB_MODELS_TOKEN e GITHUB_MODELS_MODEL, apenas se a integracao antiga do GitHub Models voltar a ser usada.

## Uso da IA

A IA externa apoia textos de feedback e relatórios.

Ela não substitui os cálculos do sistema. Os indicadores, rankings, pódios e diagnósticos do dashboard continuam sendo calculados localmente.

Quando usar IA:

- Para melhorar o tom do feedback.
- Para transformar numeros em devolutiva mais humana.
- Para incluir observacoes do gestor de forma mais profissional.
- Para gerar um plano de desenvolvimento mais claro.

Quando não usar IA:

- Para alterar cálculos.
- Para decidir ranking sem conferir os dados.
- Para substituir a revisão do gestor.

## Checklist de fechamento mensal

### Telefone

- Conferir se todas as semanas foram lancadas.
- Conferir lançamento da equipe.
- Validar ranking e pódio.
- Gerar relatórios individuais.
- Revisar texto assistido antes de enviar.

### Chat

- Importar planilhas do Zendesk.
- Conferir Base importada.
- Validar média de volume.
- Revisar excecoes de pódio.
- Gerar relatórios individuais.
- Revisar texto assistido antes de enviar.

## Boas praticas

- Sempre revise o texto gerado por IA.
- Nunca envie relatório sem conferir período e analista.
- Use observacoes do gestor para contextualizar excecoes.
- Não exclua analistas com histórico; prefira inativar.
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


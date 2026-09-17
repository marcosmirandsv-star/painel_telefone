# Trabalho na nuvem e recuperação do projeto

## Serviços existentes

- Código: https://github.com/marcosmirandsv-star/painel_telefone
- Painel publicado: https://painel-telefone.vercel.app
- Hospedagem: projeto central-performance, na Vercel.
- Banco e autenticação: projeto painel-telefone, no Supabase.

Preparar o ambiente de desenvolvimento não exige migrar banco, trocar senhas,
alterar usuários, chaves de integração, domínio ou configurações de produção.

## Preparar um ambiente Codex

Conectar o repositório acima nas configurações de ambientes da conta.
Selecionar Node.js 22 (validado em 22.22.2) e instalar as dependências com `npm ci`.
Usar também `npm ci` como manutenção quando o ambiente for retomado.
Se necessário, liberar acesso de rede para instalação de pacotes e para
fonts.googleapis.com e fonts.gstatic.com, usados na compilação.

Conferir uma cópia limpa do projeto, sem arquivos .env de produção:

```sh
npm ci
node scripts/cloud-check.mjs
```

O segundo comando executa os testes automatizados e compila usando valores
fictícios de desenvolvimento. Não é uma validação do login, de dados reais ou
de operações no Supabase. Testes com dados e login devem usar um ambiente de
homologação próprio; ele ainda não foi provisionado por esta preparação.
Não copiar credenciais administrativas de produção para o ambiente de testes.

## Fluxo das alterações

1. Criar uma branch `codex/` a partir da versão atual do projeto.
2. Pedir as alterações e executar os testes pertinentes.
3. Conferir o resultado e o que será publicado.
4. Integrar a mudança validada à main quando a publicação estiver autorizada.

A main está vinculada à publicação na Vercel. Enviar uma branch separada não
substitui a versão de produção, mas pode disparar uma prévia da Vercel conforme
as configurações existentes. Prévia não deve ser usada para alterar dados reais.

## O que fica guardado e o que precisa de cuidado separado

O GitHub guarda arquivos versionados e seu histórico. Inclui os guias em docs,
o PDF em output/pdf, código, testes, scripts e arquivos SQL existentes.
Os SQL do repositório não devem ser tratados como exportação completa do banco.

node_modules e .next são reconstruídos pela instalação e compilação.
Os arquivos .env são ignorados de propósito: credenciais devem ser mantidas em
armazenamento seguro. As configurações de produção continuam nos serviços
existentes; esta preparação não as altera nem cria backup de segredos.

Dados, contas, arquivos de Storage e configurações do Supabase precisam de um
plano próprio de backup e restauração. GitHub e ambiente Codex não os copiam.
As conversas da IA também não são copiadas automaticamente para o repositório;
decisões necessárias à continuidade devem ser registradas nesta documentação.

## Estado de implantação

Em 17/09/2026 foi criado o ambiente `painel-telefone-desenvolvimento`:
https://chatgpt.com/codex/cloud/settings/environment/6aac0c252c388191addb08402e16309e

A instalação, a compilação e os 12 testes passaram no teste remoto de
configuração, com Node 22.22.2. A conexão do terminal interativo apresentou erro
após a conclusão dos scripts; o log confirmou `Test complete`. O ambiente foi
salvo e sua página de detalhes foi conferida. Nenhuma tarefa de alteração de
código foi iniciada nessa validação.

O ambiente usa valores fictícios do Supabase, sem segredos e sem internet na
fase do agente. A instalação tem acesso de rede. Compilações posteriores que
precisem baixar fontes podem exigir ajuste restrito de rede; o teste inicial
de compilação rodou durante a instalação. Login real e operações de banco não
estão habilitados neste ambiente de desenvolvimento.

Os documentos pendentes e esta preparação estão na branch
`codex/preparar-trabalho-nuvem`. Selecioná-la quando precisar desses arquivos;
a main de produção não foi modificada. Para alterações futuras, trabalhar em
uma nova branch e revisar antes de integrar à main.

Manter a pasta local até concluir também o plano de backup de dados e segredos.
O ambiente de desenvolvimento não é um backup desses itens.

Referência: https://learn.chatgpt.com/docs/environments/cloud-environment

# Sistema de Performance de Atendimento

Painel interno para acompanhamento de performance dos modulos Telefone e Chat.

## Modulos

- Telefone: lancamentos semanais, performance da equipe, ranking, podio, relatorios SARE e texto assistido por IA.
- Chat: importacao mensal do Zendesk, conferencia da base, ranking, podio manual, metas por analista e relatorio individual com IA.

## Manual operacional

O manual de uso esta em:

[docs/manual-operacional.md](docs/manual-operacional.md)

Ele cobre:

- Como lancar dados do telefone.
- Como importar dados do chat.
- Como conferir ranking e podio.
- Como gerar relatorios.
- Como usar a IA assistida.
- Checklist de fechamento mensal.

## Desenvolvimento local

```powershell
cd C:\Users\marcos.miranda\Documents\painel_telefone
npm run dev
```

Acesse:

```text
http://localhost:3000
```

## Validacao

Antes de publicar alteracoes:

```powershell
npm run build
```

## Publicacao

O deploy de producao e feito automaticamente pela Vercel quando as alteracoes sao enviadas para a branch main.

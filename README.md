# Sistema de Performance de Atendimento

Painel interno para acompanhamento de performance dos módulos Telefone e Chat.

## Modulos

- Telefone: lançamentos semanais, performance da equipe, ranking, pódio, relatórios MIMO/SARE e texto assistido por IA.
- Chat: importação mensal do Zendesk, conferência da base, ranking, pódio manual, metas por analista e relatório individual com IA.

## Manual operacional

O manual de uso está em:

[docs/manual-operacional.md](docs/manual-operacional.md)

Ele cobre:

- Como lancar dados do telefone.
- Como importar dados do chat.
- Como conferir ranking e pódio.
- Como gerar relatórios.
- Como usar a IA assistida.
- Checklist de fechamento mensal.

## Integrações com outras plataformas

Consultas mensais, semanas do telefone e preservação de fechamentos aprovados estão descritas em [docs/integracoes.md](docs/integracoes.md). A gestão acessa `/integracoes`. A ativação externa exige aplicar `supabase/integrations.sql` e configurar credenciais próprias por plataforma.

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

O deploy de produção e feito automaticamente pela Vercel quando as alteracoes são enviadas para a branch main.

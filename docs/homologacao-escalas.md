# Homologação — Módulo de Escalas

Esta branch foi criada para desenvolver o novo módulo de escalas sem alterar a produção.

## Regra principal

- `main`: produção atual do Sistema de Performance.
- `homologacao-escala`: desenvolvimento e validação do módulo de Escalas.
- Não fazer merge para `main` antes da aprovação de Marcos, Polyana e Carine.
- Não apontar esta branch para o Supabase de produção durante testes.

## O que já foi implementado na homologação

- Cadastro central de pessoas para a Escala, sem substituir os cadastros legados de Telefone e Chat.
- Vínculos de pessoa com time usando data de início e fim.
- Saída/transferência no meio do mês refletida na grade com “—” fora da vigência.
- Times iniciais: Suporte Outros, Suporte Especializado, Telefone, Implantação, N2, Liderança e Sábados.
- Contexto mensal com feriados e pontos facultativos.
- Motor inicial de geração de Híbrido, Almoço, Lanche e Estendido.
- Validação automática de regras objetivas.
- Alteração manual de célula com bloqueio para não ser sobrescrita por nova geração.
- Liberação do mês para visualização.
- Solicitações de alteração.
- Notificações em tempo real com pop-up, contador no sino e sinal sonoro.
- Gestão configurável dos destinatários de notificações.
- Links de consulta sem login, limitados ao time/mês já publicado.
- Gestão separada de Sábados com participante fixo, rodízio, vigência e substituições manuais protegidas.

## Banco de homologação

Aplicar, nesta ordem, em um projeto Supabase de HOMOLOGAÇÃO:

1. Estrutura base já existente do Sistema de Performance.
2. `supabase/rls-policies.sql`
3. `supabase/schedule-module.sql`
4. `supabase/schedule-saturdays.sql`

Nunca aplicar os novos scripts diretamente no Supabase de produção antes da homologação.

## Rotas novas

- `/escalas` — escala mensal, pessoas/times, regras, solicitações e alertas.
- `/escalas/sabados` — rodízio anual de sábados.
- `/escalas/gestao` — destinatários de alertas, aprovação de solicitações e links públicos.
- `/escalas/publica/[token]` — consulta publicada sem login.
- `/api/schedule/public/[token]` — API somente-leitura para links publicados.

## Publicação segura

A homologação deve usar:

- projeto Vercel separado ou Preview Deployment fixado para a branch;
- projeto Supabase separado;
- variáveis de ambiente da homologação apontando apenas para o Supabase de homologação;
- banner “Ambiente de homologação” visível.

## Critérios de aceite antes de produção

- Transferência/inativação não altera histórico anterior.
- Pessoa fora da vigência não entra em nenhum cálculo.
- Férias, feriados e pontos facultativos entram na geração.
- HO → almoço 13h.
- Estendido somente em HO e respeitando restrições cadastradas.
- Lanche sem mais de 2 pessoas por horário.
- Trocas manuais não são sobrescritas.
- Sábado preserva o fixo, salvo troca manual, e equilibra a vaga de rodízio por vigência.
- Solicitação gera alerta visual, sonoro e contador em tempo real.
- Coordenadores/gestores configurados recebem alertas.
- Link sem login mostra apenas mês liberado e não expõe funções de gestão.
- Telefone e Chat atuais permanecem inalterados.

## Observação

A criação do projeto Supabase de homologação e do projeto/ambiente Vercel depende das conexões autorizadas desses serviços. O código foi mantido isolado nesta branch até essa configuração.


## Regras operacionais refinadas

- Suporte Outros: mantém a regra específica de cobertura de almoço definida pela gestão, com referência de 5 pessoas às 12h e cobertura técnica mínima quando aplicável.
- Suporte Especializado: não possui a obrigação numérica de almoço do Suporte Outros. Presencial prefere 12h–13h e HO prefere 13h–14h30, mas cobertura pode exigir exceções.
- Telefone: HO prefere 11h30–13h e Presencial prefere 13h–14h. A preferência pode ser flexibilizada por cobertura. O café é fixo por pessoa.
- N2, Liderança e Implantação: preferências de almoço 12h–13h e 13h–14h30.
- Chat (Outros e Especializado): café distribuído entre 15h45 e 17h15, de 15 em 15 minutos, no máximo duas pessoas por horário. Quem almoça mais cedo recebe prioridade para cafés mais cedo.
- Estendido: permanece restrito às pessoas elegíveis e é distribuído buscando diferença máxima de 1 participação quando possível.
- Dias e preferências individuais continuam vigentes, com prioridade abaixo de restrições e cobertura.

## Recálculo depois de solicitação aprovada

Para Telefone, Suporte Especializado, Suporte Outros e N2:

1. Day Off, Premiação, Banco de Horas e Folga viram indisponibilidades reais da pessoa na data.
2. Alteração estruturada de Home Office aplica a modalidade aprovada como exceção protegida.
3. O motor preserva dias já passados e prioriza manter o desenho já publicado nos dias futuros.
4. Híbrido é reavaliado na semana operacional somente quando necessário.
5. Almoço, café e, nos times aplicáveis, Estendido são recalculados nas datas impactadas.
6. Sábados não participam desse recálculo.
7. Se alguma regra obrigatória ficar sem solução, a solicitação fica marcada para revisão da gestão.

## Aviso ao time após mudança

Quando o recálculo realmente altera a escala:

- é criado um evento de alteração para o time;
- a consulta publicada mostra um aviso destacado;
- os dias afetados ficam visualmente marcados;
- se a consulta estiver aberta, a alteração chega em tempo real;
- ao voltar para a aba ou reabrir a escala, o sistema reconcilia as mudanças e mostra o aviso ainda não reconhecido;
- o colaborador pode autorizar a notificação nativa do navegador.

O aviso ao time não expõe o motivo pessoal da solicitação. Ele informa apenas que a escala foi atualizada e quais datas devem ser conferidas novamente.

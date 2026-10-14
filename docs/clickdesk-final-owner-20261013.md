# Reconciliação de leitura — último atendente humano

Base: homologacao, commit 35f8fb805a0c4dfb8955058e2f0b590d7d1ab6c8.

## Regra oficial aplicada

Cada ticket recebe um único crédito: último autor humano de resposta pública comprovada. Primeiro participante, owner atual, resolução e presença de avaliação não determinam esse autor. Competência: data da última resposta pública humana em America/Sao_Paulo. Avaliação explícita do ticket acompanha o mesmo autor final. Ausência de avaliação mantém o atendimento e não cria avaliação negativa. Advertências de cronologia não introduzem regras de elegibilidade adicionais.

## Implementação

Endpoints metrics, history (somente competência viva), tickets e validação de titularidade em qualitative usam o mesmo motor. Fechamentos oficiais anteriores e automação/Edge Functions permanecem intocados. Bases antiga e verificada são usadas somente para descobrir candidatos, com deduplicação por ID interno. As respostas reais de detalhe, mensagens e eventos são consultadas em GET. Mensagens públicas de agent precisam de nome identificável e único no cadastro; aprendizes não recebem crédito e o crédito não retorna ao participante anterior.

Paginação de fontes Supabase: 500, ordenação estável, limite de 20.000 com erro explícito, nunca truncamento silencioso. Histórico REST: páginas de 200, limite de 50 páginas, detecção de página repetida; divergências entre detalhe e messages impedem autoria final. Campo area vem de eventos históricos, não da equipe ou área atual. Equipe vem do cadastro.

## Autorização e segurança

Cada endpoint valida sessão/perfil pelo mecanismo existente antes da leitura administrativa. Analista diferente do vínculo autenticado recebe 403; respostas são filtradas por titularidade final. O contexto do pódio não retorna dados individuais de concorrentes. Chave administrativa existe somente no servidor, import protegido por server-only, destino estritamente vvtorcvchnqhcredhorv e VERCEL_ENV=preview. Não há fallback para a chave de produção.

Cache privado de evidência mínima no servidor, por ticket/versão/cadastro/conta, com revalidação de cinco minutos. Não armazena secrets, transcrições ou autorização. Não escreve no Supabase. Consultas frias têm prazo interno de 240 segundos, função limitada a 300; falhas e prazo excedido são apresentados como pendências. O primeiro carregamento pode ser demorado. Cobertura é a união dos candidatos capturados, não descoberta exaustiva de toda a conta ClickDesk.

## Validação real

692 candidatos vinculados historicamente a Vanessa, Thiago e Karolyne foram consultados via REST, com projeção sem conteúdo de clientes. Essa coorte não equivale ao universo global de 3.134 candidatos observado. Um ID (6721) retornou 404 nos três endpoints; nove casos ficaram inconclusivos na validação conservadora da coorte (sete autores fora do cadastro e dois históricos incompletos, incluindo o 404).

Resultado reconstruído na coorte, competência 01 a 13/10/2026:

| Analista | Antigo | Reconstruído | Avaliações | CSAT | Percentual de avaliações |
|---|---:|---:|---:|---:|---:|
| Vanessa Silva | 69 | 194 | 41 | 65,85% | 21,13% |
| Thiago Reis | 76 | 209 | 52 | 76,92% | 24,88% |
| Karolyne Moreira | 25 | 97 | 18 | 66,67% | 18,56% |

As fórmulas não mudaram; os registros e a autoria corrigida mudam numeradores e denominadores. Não apresentar estes resultados da coorte como total global definitivo da implantação. A conta continua recebendo atividade.

Controle 1054367: última mensagem pública humana 3448139, Thiago Reis, 06/10/2026 12:57:32 BRT; um crédito apenas. Registros da Vanessa posteriores a 02/10 foram considerados, com dias 05, 06, 07, 08, 09 e 13/10 presentes.

## Aceite e reversão

84 testes automatizados e compilação local aprovados na preparação. Verificar implantação READY, mesma competência/profissional nas duas sessões, capturado_em e pendências antes de declarar aceite visual completo. Se a cobertura do endpoint tiver pendências, não forçar coincidência com o painel oficial. Reversão: reverter somente o commit deste PR em homologacao e gerar novo preview; não alterar produção ou dados.

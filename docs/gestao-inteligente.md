# Gestão Inteligente — primeira versão de produção

Rota: `/gestao-inteligente`. Perfis autorizados: Master e Coordenadora, conforme autenticação e função de autorização já existentes.

## Escopo publicado

- Entrada na área de trabalho da gestão.
- Registro manual de fatos, evidência verificável, hipótese e impacto observado.
- Referência exata por origem e identificador, sem juntar tickets ClickDesk e Zendesk por semelhança.
- Acompanhamento nas sete etapas solicitadas, responsável, revisão, feedback, aprovação e encerramento justificado.
- Auditoria transacional com autor e versões; bloqueio de edição de evidência original e de casos concluídos.
- Resumo dos registros consultados, com limitação explícita a 200 casos e 500 eventos por histórico.

Não escreve em tabelas de indicadores, avaliações, créditos, produtividade, CSAT ou pódio. Não associa ocorrências a analistas nem produz avaliações individuais. Não executa encaminhamentos ou medidas disciplinares.

## Diferença em relação à homologação

Baseada no commit de produção `5249b264f79455520d586ba0f81a4333628eb07f`, sem promover as alterações operacionais da branch de homologação.

O banco de produção `qmetbydkepfdgfqkdkai` não possuía as tabelas qualitativas e de conciliação ClickDesk existentes em homologação. Por isso, esta versão publica o fluxo manual de gestão e informa expressamente que diagnósticos automáticos não estão integrados. Nenhum resultado de homologação foi copiado.

O SQL `supabase/cx360-production.sql` é exclusivo desta implantação em produção; não substituir o SQL diferente da primeira versão de homologação. Acrescenta apenas `cx360_cases`, `cx360_events`, índices, políticas e funções privadas de trigger. O cliente da API usa JWT da sessão e chave pública; RLS continua aplicada, sem credencial de serviço.

## Verificação

- Compilação Next.js concluída.
- Verificação de tipos e lint dos arquivos novos concluídos.
- 17 testes Node aprovados: 12 das integrações existentes e 5 das regras de acompanhamento.
- `supabase/tests/cx360-production.sql` aprovado no banco, dentro de transação revertida: ciclo completo, aprovação explícita, proteção do plano aprovado, justificativa de encerramento, autoria da auditoria, incremento de versão e recusa de analista/anônimo.
- Nenhum achado do advisor de segurança associado aos novos objetos. Avisos anteriores do projeto não foram alterados.
- Após o teste, zero ocorrências e zero eventos persistidos.

## Pendências conhecidas

Integração das fontes reais ClickDesk de produção, diagnósticos e assistente conversacional, radar em tempo real, relatórios diários e semanais automáticos, comparação de evolução com amostra suficiente e homologação do fluxo completo no navegador com sessão de gestor.

## Reversão

Se necessário, reimplantar o commit anterior da aplicação. As novas tabelas são aditivas e podem permanecer, preservando os registros de gestão; não é necessário apagar dados nem reverter indicadores.

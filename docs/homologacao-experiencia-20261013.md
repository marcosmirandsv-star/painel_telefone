# Homologação — experiência compartilhada do Chat

Base: `homologacao` em `da07fca30e730a748b086bc97ca79a2197858c62`.
Referências revisadas: PR #22, `ui/demo-gestao-20261012` e `fix/chat-unified-parity-20261012`.

## Seleção de escopo

O PR #22 contém 111 commits incluindo captura, novas fontes de indicadores, APIs e Edge Functions. Não foi integrado integralmente. A mudança de contabilização por último atendente depende da auditoria separada e não faz parte desta entrega.

## Entregue

- Um único componente de resumo para gestor e analista: atendimentos, CSAT, avaliações, metas, positivas e negativas, sem recalcular os valores retornados pela API existente.
- Um seletor compartilhado por identidade; quando existem várias filas para a mesma pessoa, não soma nem escolhe uma por suposição e informa a pendência.
- Seleção de competência no acesso individual, com data operacional em America/Sao_Paulo e limpeza dos detalhes ao trocar período.
- Navegação compacta entre Operação, Equipe e produtividade, Gestão e ações e Fechamento.
- Briefing/radar e diagnóstico complementar em painéis recolhíveis para reduzir rolagem. Diagnóstico complementar identificado como possível fonte diferente do resumo compartilhado.
- Alertas de cobertura parcial: ausência de captura não comprova zero, sincronização concluída não garante cobertura completa, dados parciais não são fechamento oficial.
- Home conjunta, foto, ranking individual, sincronização, metas e Telefone já presentes na base foram preservados.

## Segurança e testes

Nenhuma alteração em APIs, indicadores, metas, regras de ranking/pódio, autenticação, dependências, banco, cron, Edge Functions ou produção.

68 testes automatizados aprovados; TypeScript e build Next.js 16.2.10 aprovados com configuração pública sintética, sem .env antigo. Cinco fixtures de teste 360 receberam tipagem literal de status, sem mudança de comportamento, para remover erros de compilação preexistentes.

Os testes comprovam seleção por identidade, comportamento de ambiguidades, reutilização do resumo, limites de fuso/período e regressões de permissões/indicadores/Telefone. Não equivalem à validação visual autenticada de Vanessa, Thiago e Karolyne contra dados reais.

## Pendências explícitas

- Conciliação de captura/CSAT e consolidação de múltiplas filas permanecem separadas; não foram incorporadas para obter números artificialmente coincidentes.
- Confirmar paridade numérica com sessões reais de gestor e analista, mesmo profissional, competência e fonte. Sem sessão autenticada disponível, não declarar aceite funcional completo.
- Acesso externo está sujeito à proteção Vercel existente; compartilhamento temporário não deve remover a autenticação da aplicação nem enfraquecer proteção global.
- O npm reportou vulnerabilidades preexistentes nas dependências; nenhuma atualização automática foi executada neste escopo visual.

## Reversão

Reverter somente o commit desta entrega na branch homologacao, gerando um novo preview. Não promover nem reverter produção; não executar migrations ou alterar dados.

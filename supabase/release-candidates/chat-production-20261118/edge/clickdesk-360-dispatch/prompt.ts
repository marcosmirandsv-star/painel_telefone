export function buildQualitativePrompt(input: {
  transcript: string
  satisfaction: string | null
  area: string | null
  occurredDate: string | null
}) {
  return `
Você é um analista de qualidade de atendimento. Analise somente o conteúdo fornecido e devolva JSON válido.

OBJETIVO
Identificar sinais qualitativos úteis para gestão sem transformar hipótese em fato.

REGRAS OBRIGATÓRIAS
- Não invente causa, sentimento, responsabilidade ou comportamento.
- O CSAT/satisfação registrada não prova sozinho a causa da nota.
- Quando a evidência não for suficiente, use "unclear" e confiança "low".
- Para influência humana, só use improved ou worsened quando o transcript mostrar mudança atribuível à atuação humana.
- Não deduza intenção, personalidade, capacidade, esforço ou estado emocional interno do atendente.
- "Sentimento" significa apenas o tom observável da interação, não diagnóstico psicológico.
- Em controllability, use analyst somente quando houver ação concreta sob controle do analista; company para sistema/processo interno; external para fatores de fora; customer para decisão/condição do cliente; mixed quando houver mais de um fator demonstrável.
- Escolha primary_cause.category pela causa concreta observável, não pelo tema geral da conversa.
- Use customer_expectation SOMENTE quando o transcript mostrar uma diferença explícita entre o que o cliente esperava e o que o atendimento/produto/processo podia entregar. Nesse caso, primary_cause.summary deve escrever obrigatoriamente "O cliente esperava X, mas Y ocorreu/foi possível", deixando X e Y concretos.
- Não use customer_expectation apenas porque o cliente tinha uma dúvida, pediu orientação ou ficou insatisfeito.
- Encerramento automático por inatividade/regra de timeout deve ser process quando a regra operacional for o fator principal.
- Encerramento prematuro pelo atendente ou investigação que não avança deve ser resolution_quality quando a condução humana for o fator principal.
- Falha, comportamento incorreto, sincronização ou limitação do software deve ser system_or_product quando houver evidência no transcript.
- Dependência de definição contábil, fiscal, SEFAZ ou outro agente externo deve ser external quando essa dependência for o fator principal; se o ponto central for a expectativa de que o suporte fornecesse uma definição fora do seu escopo, customer_expectation só é válido se essa expectativa estiver explícita e o summary explicar exatamente qual era.
- Dúvida sobre passo a passo, primeira emissão, CNPJ ou uso do sistema não é customer_expectation por si só; classifique communication, process, resolution_quality ou unclear conforme a evidência.
- coaching_signal.available deve ser true somente quando houver comportamento observável que possa ser trabalhado em feedback gerencial.
- analyst_takeaway é independente de coaching_signal e responde ao que a própria pessoa pode aprender com este atendimento.
- analyst_takeaway.kind = maintain quando houver comportamento observável adequado que valha repetir, mesmo que ele não seja a causa principal da avaliação.
- analyst_takeaway.kind = develop somente quando houver comportamento observável sob controle do analista que possa ser aprimorado.
- analyst_takeaway.kind = context quando o principal aprendizado for reconhecer que o fator relevante estava fora do controle direto do analista.
- analyst_takeaway.kind = none somente quando o transcript realmente não oferecer evidência segura para manter, desenvolver ou contextualizar.
- O summary de analyst_takeaway deve ser específico ao que aparece na conversa; não use uma frase genérica repetida em todos os tickets.
- Em maintain, não apenas descreva o que o atendente fez. Transforme a evidência em uma prática repetível: diga qual comportamento vale manter, em que situação e por quê. Exemplo de forma: "Ao surgir dúvida sobre o caminho no sistema, mantenha a orientação passo a passo, porque ela reduz ambiguidade e deixa claro o próximo movimento."
- Em develop, descreva uma ação concreta que a pessoa pode praticar; evite rótulos abstratos como "melhorar comunicação".
- Em context, explique o fator fora do controle direto e, quando houver evidência, o que ainda cabe ao analista fazer sem assumir culpa pelo problema.
- Uma avaliação positiva ou negativa, sozinha, nunca define o analyst_takeaway.
- evidence_summary deve ter no máximo 3 itens, em paráfrase curta. Não copie dados pessoais nem trechos longos.
- A leitura de CX deve ser útil à gestão mesmo quando NÃO existe falha humana comprovada. Não responda só "inconclusivo" ou "sem evidência para feedback": separe observação, hipótese e oportunidade prática.
- A hipótese da nota negativa deve explicar um possível elo causa → impacto na experiência → nota, sempre rotulado como hipótese quando o cliente não declarou o motivo. Não trate frustração provável como sentimento psicológico comprovado.
- Distinguir: (1) defeito do produto/processo, (2) ação REALMENTE observada do analista, (3) percepção possível do cliente, (4) prática adicional a ser adotada no próximo caso. Não atribua mau humor, má vontade, desinteresse ou falta de empatia sem fala ou conduta inequívoca no transcript.
- No coaching, aponte UM comportamento específico praticável (p. ex. validar se o cliente conseguiu repetir a emissão, resumir passos ou registrar retorno), explicando efeito esperado. Não afirme que faltou na conversa se não há prova da omissão.
- Em suggested_phrase dê uma fala pronta, curta, humana e tecnicamente viável em português, sem prometer solução garantida, sem culpar cliente e sem supor uma ação que não ocorreu.
- Em verification_check ofereça um indicador objetivo para a gestão conferir em novo ticket (não a mudança futura do CSAT, que depende do cliente).
- Em attribution_caution registre o limite causal de maneira específica. Ser coach é orientar boas práticas, não fabricar culpa.
- limitations deve registrar o que não pode ser concluído com segurança.
- Não reproduza e-mail, telefone, CPF, CNPJ, IDs ou outros identificadores.
- Responda SOMENTE com JSON, sem Markdown.

VALORES PERMITIDOS
initial_sentiment/final_sentiment: positive | neutral | negative | mixed | unclear
primary_cause.category: system_or_product | process | wait_time | communication | resolution_quality | customer_expectation | external | other | unclear
primary_cause.confidence: low | medium | high
human_influence.classification: improved | worsened | neutral | unclear
human_influence.confidence: low | medium | high
controllability.classification: analyst | company | customer | external | mixed | unclear
analyst_takeaway.kind: maintain | develop | context | none
analyst_takeaway.confidence: low | medium | high

FORMATO EXATO
{
  "initial_sentiment": "unclear",
  "final_sentiment": "unclear",
  "primary_cause": {
    "category": "unclear",
    "summary": "",
    "confidence": "low"
  },
  "human_influence": {
    "classification": "unclear",
    "summary": "",
    "confidence": "low"
  },
  "controllability": {
    "classification": "unclear",
    "summary": ""
  },
  "coaching_signal": {
    "available": false,
    "summary": ""
  },
  "analyst_takeaway": {
    "kind": "none",
    "summary": "",
    "confidence": "low"
  },
  "evidence_summary": [],
  "limitations": [],
  "cx_coaching": {
    "negative_rating_hypothesis": "Hipótese objetiva para a avaliação recebida: se positiva, descreva o que pode ter contribuído para a satisfação; se negativa, o que pode ter causado insatisfação. Nunca trate uma nota positiva como negativa. Distinga motivo declarado de motivo não comprovado.",
    "customer_experience_impact": "Impacto possível da ocorrência na percepção do cliente; só atribua emoção expressa na conversa.",
    "observable_analyst_behavior": "O que o analista efetivamente fez ou disse, sem julgamento de caráter.",
    "practice_to_improve": "Um procedimento de CX prático e específico para atendimento semelhante, sem presumir que tenha faltado neste.",
    "suggested_phrase": "Frase natural que o analista poderia utilizar em atendimento semelhante.",
    "verification_check": "Um item verificável no transcript futuro que a gestão possa conferir.",
    "attribution_caution": "O que impede afirmar que o analista causou a nota, quando não houver prova.",
    "evidence_confidence": "low"
  }
}

CONTEXTO OPERACIONAL
Área: ${input.area ?? 'não identificada'}
Data: ${input.occurredDate ?? 'não identificada'}
Satisfação registrada: ${input.satisfaction ?? 'sem avaliação'}

TRANSCRIPT REDIGIDO
${input.transcript}
`
}

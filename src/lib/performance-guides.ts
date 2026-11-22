import type { PerformanceNavGroup, PerformancePageHelp } from '@/components/ui/PerformanceNavigation'

export const chatManagementNavigation: PerformanceNavGroup[] = [
  { label: 'Entender a operação', items: [
    { id: 'overview', label: 'Operação', description: 'Indicadores e evolução do período', icon: 'activity' },
    { id: 'prototype', label: 'Equipe e produtividade', description: 'Distribuição dos resultados', icon: 'users' },
  ] },
  { label: 'Qualidade e desenvolvimento', items: [
    { id: 'operation360', label: 'Visão 360º', description: 'Evidências e aprendizado por ticket', icon: 'scan' },
    { id: 'podium', label: 'Gestão e ações', description: 'Prioridades e acompanhamento', icon: 'clipboard' },
  ] },
  { label: 'Resultados', items: [
    { id: 'analysis', label: 'Pódio', description: 'Critérios e elegibilidade', icon: 'trophy' },
    { id: 'reports', label: 'Relatórios', description: 'Fechamento e devolutivas', icon: 'file' },
  ] },
  { label: 'Administração do Chat', items: [
    { id: 'import', label: 'Importar histórico', description: 'Arquivo anterior do Zendesk', icon: 'history' },
    { id: 'settings', label: 'Cadastros do Chat', description: 'Equipe, analistas e metas', icon: 'settings' },
  ] },
]

export const chatAnalystNavigation: PerformanceNavGroup[] = [
  { label: 'Meu acompanhamento', items: [
    { id: 'my-result', label: 'Meu resultado', description: 'Metas e indicadores pessoais', icon: 'activity', href: '#meu-resultado' },
    { id: 'my-ratings', label: 'Minhas avaliações', description: 'Notas e leitura dos tickets', icon: 'message', href: '#minhas-avaliacoes' },
    { id: 'my-days', label: 'Meus dias', description: 'Atendimentos por data', icon: 'calendar', href: '#minha-rotina' },
    { id: 'my-history', label: 'Minha evolução', description: 'Comparar competências ClickDesk', icon: 'chart', href: '#minha-evolucao' },
  ] },
  { label: 'Consulta histórica', items: [
    { id: 'prior-history', label: 'Histórico anterior', description: 'Zendesk antes da migração', icon: 'history', href: '#historico-anterior' },
  ] },
]

export const phoneNavigation: PerformanceNavGroup[] = [
  { label: 'Acompanhamento', items: [
    { id: 'dashboard', label: 'Painel telefônico', description: 'Indicadores e resultado do time', icon: 'headphones' },
    { id: 'reports', label: 'Relatórios', description: 'Histórico e análises de desempenho', icon: 'file' },
  ] },
  { label: 'Manutenção da operação', items: [
    { id: 'entries', label: 'Lançamentos', description: 'Registrar resultados semanais', icon: 'list' },
    { id: 'analysts', label: 'Analistas', description: 'Cadastro do time telefônico', icon: 'users' },
    { id: 'goals', label: 'Metas', description: 'Parâmetros do telefone', icon: 'target' },
  ] },
  { label: 'Conferência', items: [
    { id: 'closures', label: 'Fechamentos', description: 'Consultar competências aprovadas', icon: 'shield', href: '/integracoes' },
  ] },
]

export const phoneAnalystNavigation: PerformanceNavGroup[] = [
  { label: 'Visão individual', items: [
    { id: 'dashboard', label: 'Meu painel telefônico', description: 'Seu histórico e indicadores', icon: 'headphones' },
  ] },
]

export const chatManagementHelp: Record<string, PerformancePageHelp> = {
  overview: {
    category: 'Visão geral',
    title: 'Como ler a operação do Chat',
    summary: 'Acompanhe qualidade, participação nas avaliações e volume. O total oficial é independente da série por dia, que só aparece quando a captura daquela data foi confirmada.',
    howTo: ['Escolha a equipe e a competência no topo.', 'Use Dia, Semana, Mês ou Personalizado para consultar um intervalo disponível.', 'Analise os indicadores e as comparações sem confundir histórico Zendesk com o período ClickDesk.'],
    fields: [
      { label: 'CSAT', meaning: 'Participação de avaliações positivas nas avaliações consideradas pela regra de apuração.' },
      { label: '% de avaliações', meaning: 'Quantidade de avaliações dividida pelos atendimentos válidos do período.' },
      { label: 'Recebidos', meaning: 'Quantidade contabilizada pelo relatório oficial do ClickDesk, para o responsável selecionado.' },
      { label: 'Volume diário', meaning: 'Somente dias capturados e confirmados individualmente. Lacuna significa ausência de apuração, não zero.' },
    ],
    caution: 'O volume demonstra produtividade; a qualidade deve ser investigada pelo atendimento e pelas evidências, não apenas pela quantidade.',
  },
  prototype: {
    category: 'Pessoas e resultados',
    title: 'Como comparar a equipe sem perder o contexto',
    summary: 'Compare resultados de cada analista e visualize o trabalho do time. Os atendimentos de um analista são agrupados pelo seu cadastro, que pode diferir da fila onde o cliente entrou.',
    howTo: ['Filtre a equipe e o mês.', 'Observe primeiro CSAT e participação nas avaliações, depois o volume.', 'Abra o detalhamento individual antes de decidir qualquer orientação.'],
    fields: [
      { label: 'CSAT individual', meaning: 'Satisfação observada na amostra de avaliações atribuídas ao analista.' },
      { label: 'Avaliações', meaning: 'Número de respostas do cliente utilizadas no indicador, sujeito à cobertura da fonte.' },
      { label: 'Volume e média', meaning: 'Atendimentos recebidos no período e média entre os profissionais considerados.' },
      { label: 'Equipe', meaning: 'Lotação cadastrada do analista. Não confundir com o departamento de origem do ticket.' },
    ],
    caution: 'Amostra pequena de avaliações exige cautela. Não conclua que volume elevado significa experiência boa ou ruim.',
  },
  operation360: {
    category: 'Qualidade da experiência',
    title: 'Como usar a Visão 360º',
    summary: 'Investigue o que o cliente viveu, o comportamento observável do atendimento e o próximo passo de desenvolvimento. A IA não transforma uma nota negativa em culpa automática.',
    howTo: ['Selecione o período e a equipe.', 'Confira se há tickets com autoria humana final e histórico comprovados.', 'Abra a análise de um ticket, examine evidências, limites e sugestões; valide ou conteste antes de usar no feedback.'],
    fields: [
      { label: 'Cobertura', meaning: 'Parcela dos tickets avaliados que já possui leitura qualitativa disponível e verificada.' },
      { label: 'Esforço do cliente', meaning: 'Tentativas, repetições e transferências observáveis — apenas quando constam da conversa.' },
      { label: 'Desfecho', meaning: 'Resultado confirmado, parcial, encaminhado ou ainda não demonstrado na evidência acessível.' },
      { label: 'Orientações', meaning: 'Uma ação praticável para o analista e uma verificação específica para a gestão.' },
    ],
    caution: 'Se o inventário por ticket não estiver disponível, a tela deve apontar cobertura pendente, nunca exibir zero como desempenho.',
  },
  podium: {
    category: 'Acompanhamento gerencial',
    title: 'Como transformar dados em ações',
    summary: 'Identifique padrões de qualidade, acompanhe intervenções e registre as decisões da gestão. Utilize relatos qualitativos apenas quando houver evidência suficiente.',
    howTo: ['Confira a cobertura das avaliações e as prioridades da amostra.', 'Valide os tickets e separe situações do produto, processo, IA e condução humana.', 'Defina uma prática concreta, responsável e revisão futura; acompanhe se o comportamento mudou.'],
    fields: [
      { label: 'Prioridade', meaning: 'Tema de acompanhamento sugerido, não sanção nem classificação definitiva do profissional.' },
      { label: 'Evidência', meaning: 'Trechos ou fatos observados que justificam o diagnóstico.' },
      { label: 'Hipótese', meaning: 'Possível explicação ainda não confirmada pelo cliente ou pela apuração.' },
      { label: 'Ação', meaning: 'Orientação com responsável e critério de verificação para o próximo ciclo.' },
    ],
    caution: 'O feedback deve ser proporcional à amostra. Não atribua causa ao analista quando o transcript ou os anexos não permitem concluir.',
  },
  analysis: {
    category: 'Reconhecimento',
    title: 'Como funciona o pódio',
    summary: 'A elegibilidade combina qualidade, participação nas avaliações e volume relativo à média. O pódio só é conclusivo com o período e a cobertura verificados.',
    howTo: ['Selecione a competência fechada.', 'Confira CSAT, percentual de avaliações e volume comparável.', 'Analise justificativas de elegibilidade e eventuais exceções antes de divulgar o resultado.'],
    fields: [
      { label: 'CSAT de referência', meaning: '90% para a premiação do pódio; a meta individual de base pode ser diferente.' },
      { label: 'Participação mínima', meaning: 'Pelo menos 25% dos atendimentos válidos avaliados.' },
      { label: 'Volume', meaning: 'Atendimentos ao menos iguais à média dos participantes elegíveis conforme a regra do painel.' },
    ],
    caution: 'Não usar resultados parciais ou uma quantidade pequena de avaliações como prêmio ou punição definitiva.',
  },
  reports: {
    category: 'Comunicação e fechamento',
    title: 'Relatórios e devolutivas',
    summary: 'Consolide os resultados do período e produza devolutivas individuais. A exportação para Word utiliza a fonte selecionada e as análises qualitativas aprovadas.',
    howTo: ['Confirme o período e a equipe.', 'Selecione o analista e confira os números e a origem.', 'Revise evidências e feedback, depois gere o documento Word.'],
    fields: [
      { label: 'Competência', meaning: 'Mês ou intervalo ao qual os resultados do relatório pertencem.' },
      { label: 'Analista', meaning: 'Profissional titular do relatório e dos indicadores selecionados.' },
      { label: 'Feedback', meaning: 'Devolutiva que deve ser conferida pela gestão antes do envio.' },
      { label: 'Exportar Word', meaning: 'Gera um arquivo no navegador; não substitui automaticamente o fechamento oficial.' },
    ],
    caution: 'Evite combinar a série Zendesk anterior com o ClickDesk como se tivessem a mesma base de contagem.',
  },
  import: {
    category: 'Administração · histórico anterior',
    title: 'Importar arquivos legados do Zendesk',
    summary: 'Esta tela preserva dados anteriores à migração. Não serve para importar números do ClickDesk nem alterar automaticamente indicadores oficiais.',
    howTo: ['Selecione o mês e o ano correspondentes aos arquivos originais.', 'Anexe as planilhas de satisfação e inatividade compatíveis.', 'Revise a importação realizada no histórico antes de qualquer correção ou exclusão.'],
    fields: [
      { label: 'Satisfação', meaning: 'Arquivo Zendesk com avaliações do período histórico.' },
      { label: 'Inatividade', meaning: 'Arquivo Zendesk com registros usados na regra histórica de contagem.' },
      { label: 'Excluir mês', meaning: 'Ação destrutiva sobre o histórico importado; confira competência e impacto antes de executar.' },
    ],
    caution: 'Os dados de outubro parcialmente importados não são série comparável. Esta ação nunca deve corrigir manualmente o CSAT oficial ClickDesk.',
  },
  settings: {
    category: 'Administração · Chat',
    title: 'Cadastros e regras do módulo',
    summary: 'Gerencie a estrutura do Chat: equipes, analistas, metas e fotos. O acesso à conta de usuário é administrado separadamente em Sistema.',
    howTo: ['Encontre a equipe ou o analista que deseja revisar.', 'Confirme nome, lotação e meta antes de salvar.', 'Use a gestão de acessos apenas no módulo Sistema; não altere o cadastro para forçar coincidência de indicadores.'],
    fields: [
      { label: 'Equipe', meaning: 'Lotação do profissional para agrupamento dos indicadores.' },
      { label: 'Meta de CSAT', meaning: 'Referência individual exibida para desenvolvimento; não equivale automaticamente à regra de premiação.' },
      { label: 'Foto', meaning: 'Imagem de identificação exibida no painel e em relatórios.' },
    ],
    caution: 'Um vínculo de equipe incorreto pode alterar a visualização do relatório. Preserve o histórico e valide mudanças cadastrais.',
  },
}

export const chatAnalystHelp: PerformancePageHelp = {
  category: 'Espaço individual',
  title: 'Seu desempenho e seu desenvolvimento',
  summary: 'Este espaço mostra exclusivamente seus indicadores, avaliações, dias de atendimento e histórico. Use as análises de tickets para aprender o que repetir e o que melhorar.',
  howTo: [
    'Escolha a competência e o intervalo para atualizar seus resultados.',
    'Consulte CSAT e participação nas avaliações antes de interpretar a quantidade atendida.',
    'Abra uma avaliação ou um dia específico para examinar seus tickets e a orientação de CX.',
  ],
  fields: [
    { label: 'Competência', meaning: 'Mês que você deseja consultar. Os resultados do mês atual ainda podem mudar.' },
    { label: 'Visualizar período', meaning: 'Permite consultar um dia, semana, mês ou intervalo personalizado, quando houver captura oficial disponível.' },
    { label: 'CSAT ajustado', meaning: 'Percentual de avaliações positivas entre as consideradas pela regra oficial de apuração.' },
    { label: 'Participação nas avaliações', meaning: 'Percentual de seus atendimentos que recebeu avaliação do cliente.' },
    { label: 'Minha evolução', meaning: 'Comparação de seus indicadores entre competências ClickDesk; histórico Zendesk fica separado.' },
  ],
  caution: 'A IA sugere oportunidades a partir das evidências acessíveis. A nota do cliente não é prova automática de falha, e você não tem acesso aos dados individuais de colegas.',
}

export const phoneHelp: Record<string, PerformancePageHelp> = {
  dashboard: {
    category: 'Telefone · indicadores',
    title: 'Como acompanhar o resultado telefônico',
    summary: 'Consulte sua operação telefônica com os indicadores registrados no painel. A alimentação do Telefone é manual e independente dos relatórios do Chat.',
    howTo: ['Confira a competência da apuração e os dados disponíveis.', 'Compare performance de chamadas, CSAT e volume sem confundir as três medidas.', 'Gestores podem avançar para relatórios e lançamentos; analistas visualizam os próprios resultados.'],
    fields: [
      { label: 'Performance', meaning: 'Chamadas atendidas ÷ (atendidas + perdidas), multiplicado por 100.' },
      { label: 'CSAT', meaning: 'Percentual de satisfação entre avaliações recebidas no atendimento telefônico.' },
      { label: 'Atendimentos', meaning: 'Volume de ligações registrado no período e na fonte selecionada.' },
    ],
    caution: 'Telefone e Chat utilizam fontes e regras próprias. Não transferir números de um módulo para o outro.',
  },
  reports: {
    category: 'Telefone · análise',
    title: 'Relatórios e evolução da operação',
    summary: 'Examine o histórico de performance e satisfação da equipe telefônica, destacando tendências e oportunidades de atuação.',
    howTo: ['Defina o intervalo disponível.', 'Confira o resultado geral e individual.', 'Use o relatório como apoio ao feedback e verifique a origem de cada lançamento.'],
    fields: [
      { label: 'Período', meaning: 'Semanas e competências incluídas na consulta.' },
      { label: 'Meta', meaning: 'Referência definida para o indicador exibido.' },
      { label: 'Comparativo', meaning: 'Diferença entre resultados registrados, respeitando as fontes e as ausências.' },
    ],
  },
  entries: {
    category: 'Telefone · registro',
    title: 'Lançar e conferir dados semanais',
    summary: 'Registre os indicadores do Telefone. Diferentemente do Chat, esta é uma atividade de atualização manual dos dados.',
    howTo: ['Selecione o analista ou o resultado geral correto.', 'Preencha a semana, as quantidades e as evidências.', 'Confira o resumo antes de salvar ou excluir algum lançamento.'],
    fields: [
      { label: 'Atendidas', meaning: 'Chamadas efetivamente atendidas.' },
      { label: 'Perdidas', meaning: 'Chamadas não atendidas, consideradas na fórmula de performance.' },
      { label: 'Evidência', meaning: 'Documento ou registro que sustenta os números lançados.' },
    ],
    caution: 'Exclusões e correções mudam indicadores históricos. Confira os registros antes de salvar.',
  },
  analysts: {
    category: 'Telefone · pessoas',
    title: 'Cadastro da equipe telefônica',
    summary: 'Mantenha os colaboradores do Telefone corretamente vinculados, com status e foto. Não confundir esse cadastro com os responsáveis de tickets do Chat.',
    howTo: ['Localize o profissional.', 'Revise o cadastro, foto e situação.', 'Salve somente após conferir os dados e a equipe correspondente.'],
    fields: [
      { label: 'Ativo', meaning: 'Define se o colaborador entra no conjunto considerado pelo painel, conforme a regra da operação.' },
      { label: 'Foto', meaning: 'Imagem utilizada na identificação visual e em relatórios.' },
      { label: 'Meta individual', meaning: 'Referência de CSAT adotada para aquele profissional.' },
    ],
  },
  goals: {
    category: 'Telefone · regras',
    title: 'Metas e referências da operação telefônica',
    summary: 'Consulte e ajuste os parâmetros utilizados para comparar resultados e metas na operação do Telefone.',
    howTo: ['Identifique a meta que deseja revisar.', 'Confira sua unidade, valor e situação.', 'Salve o parâmetro e valide seu efeito nos relatórios antes de utilizá-lo em feedback.'],
    fields: [
      { label: 'Meta', meaning: 'Valor de referência para avaliar determinado indicador.' },
      { label: 'Unidade', meaning: 'Percentual, quantidade ou outra medida associada à meta.' },
      { label: 'Ativa', meaning: 'Indica se a referência está habilitada para utilização.' },
    ],
    caution: 'Mudar uma meta não altera automaticamente os fatos observados nem os indicadores oficiais de outras fontes.',
  },
}

export const systemHelp: PerformancePageHelp = {
  category: 'Sistema · permissões',
  title: 'Usuários e acessos',
  summary: 'Administre as contas que podem entrar na Central. Este módulo fica separado de Telefone e Chat para evitar confundir cadastro de profissionais com credenciais de acesso.',
  howTo: ['Confira a pessoa e sua função antes de criar ou alterar uma conta.', 'Associe corretamente o analista e a área permitida.', 'Valide o acesso com sessão individual antes de liberar outros usuários.'],
  fields: [
    { label: 'Perfil', meaning: 'Define se a conta é de gestão ou de analista, com permissões diferentes.' },
    { label: 'Vínculo', meaning: 'Relaciona a conta ao cadastro correto para limitar a visão individual.' },
    { label: 'Acesso à gestão', meaning: 'Permite consultas coletivas e ações de administração somente para funções autorizadas.' },
  ],
  caution: 'Nunca conceda acesso coletivo ou a dados de outra equipe para contornar um problema de visualização. Não compartilhe senhas.',
}


export const vacationNavigation: PerformanceNavGroup[] = [
  { label: 'Planejamento de pessoas', items: [
    { id: 'history', label: 'Períodos e histórico', description: 'Consulte férias e situação atual', icon: 'calendar' },
    { id: 'planning', label: 'Planejamento e cobertura', description: 'Programar ausências e conferir sobreposições', icon: 'chart' },
    { id: 'people', label: 'Pessoas e times', description: 'Lotação, gestores e cadastros', icon: 'users' },
  ] },
]

export const vacationHelp: Record<string, PerformancePageHelp> = {
  history: {
    category: 'Gestão de pessoas · consulta',
    title: 'Histórico e situação das férias',
    summary: 'Encontre períodos planejados, programados, encerrados ou cancelados. A consulta externa ao Gente Gestão é uma fonte separada, somente para leitura.',
    howTo: ['Filtre time, pessoa, situação e intervalo.', 'Abra um registro antes de alterá-lo ou cancelá-lo.', 'Use Consultar Gente Gestão para confrontar dados externos, sem importar automaticamente períodos.'],
    fields: [
      {label:'Planejada',meaning:'Intenção ou previsão de férias ainda não confirmada para a programação.'},
      {label:'Programada',meaning:'Período registrado como programado na base interna.'},
      {label:'Concluída',meaning:'Férias cujo período já terminou; permanecem no histórico.'},
      {label:'Gente Gestão',meaning:'Consulta externa somente leitura; não é substituta automática da base interna.'},
    ],
    caution: 'Os períodos são registros de planejamento. Verifique o controle oficial de RH antes de comunicar uma aprovação definitiva.',
  },
  planning: {
    category: 'Gestão de pessoas · programação',
    title: 'Programar férias e conferir cobertura',
    summary: 'Organize ausências e identifique pessoas do mesmo time com períodos sobrepostos antes de definir a cobertura operacional.',
    howTo: ['Selecione o time e a pessoa.', 'Preencha início, fim e situação.', 'Confira os dias corridos e o alerta de sobreposição; confirme o plano antes de salvar.'],
    fields: [
      {label:'Início e fim',meaning:'Os dois dias são incluídos no total de dias corridos.'},
      {label:'Situação',meaning:'Planejada é previsão; Programada é o registro operacional para acompanhar a ausência.'},
      {label:'Ticket do DP',meaning:'Referência do processo com o departamento responsável por pessoal.'},
      {label:'Abono pecuniário',meaning:'Quantidade de dias solicitados para conversão, conforme as regras aplicáveis; não é uma aprovação do RH.'},
    ],
    caution: 'Sobreposições são alertas de capacidade, não validações automáticas de cobertura. Confirme a disponibilidade dos profissionais antes de aprovar o plano.',
  },
  people: {
    category: 'Gestão de pessoas · estrutura',
    title: 'Pessoas, lotação e gestores',
    summary: 'Mantenha a estrutura de times e responsáveis para os controles de férias. O cadastro de analistas originado no Chat ou Telefone preserva seus dados próprios.',
    howTo: ['Localize uma pessoa do quadro ou crie cadastro para quem ainda não consta.', 'Confira time e gestor e registre as alterações.', 'Antes de criar um time, confirme se já existe um equivalente.'],
    fields: [
      {label:'Time',meaning:'Equipe considerada para identificar períodos simultâneos e pessoas disponíveis.'},
      {label:'Gestor',meaning:'Responsável de referência para acompanhamento.'},
      {label:'Cadastro de origem',meaning:'Para profissionais do Chat/Telefone, nome, foto e situação podem vir do módulo original.'},
    ],
    caution: 'Não altere lotação para corrigir números do ClickDesk. Mudanças de cadastro devem corresponder à organização real.',
  },
}

export const closuresHelp: PerformancePageHelp = {
  category: 'Administração · validação de dados',
  title: 'Fechamentos oficiais',
  summary: 'Consulte os resultados disponíveis ou preserve uma fotografia oficial de uma competência já encerrada. Conferir não é aprovar.',
  howTo: [
    'Escolha mês, canal e, se for Chat, equipe.',
    'Use Conferir dados atuais para visualizar sem alterar os números.',
    'Somente após validar os dados, marque a confirmação e utilize Aprovar fechamento; Ver fechamento oficial apenas consulta registros preservados.',
  ],
  fields: [
    {label:'Mês',meaning:'Competência de referência do fechamento. A aprovação só deve considerar o período concluído.'},
    {label:'Canal',meaning:'Fonte de Telefone (alimentação manual) ou Chat (ClickDesk), sem misturar contagens.'},
    {label:'Equipe',meaning:'No Chat, limita a captura ao time escolhido. Todas as equipes não cria automaticamente fechamentos individuais.'},
    {label:'Conferir dados atuais',meaning:'Faz leitura dos resultados disponíveis sem preservar ou substituir fechamento.'},
    {label:'Aprovar fechamento',meaning:'Preserva o resultado conferido. A operação exige confirmação e não permite substituição nesta versão.'},
  ],
  caution:'Uma cópia preservada não se atualiza automaticamente. Não aprove números de uma amostra ou período incompleto.',
}

import { ApiError, authorizeClickDeskSessionClient, handle, json } from '@/lib/integration-server'
import { getServerSupabaseConfig } from '@/lib/runtime-environment'

export const runtime = 'nodejs'

type Contribution = {
  ticket_id: string
  analyst_id: string | null
  rating_attribution: string | null
  satisfaction_label: string | null
}
type Analyst = { id: string; name: string; team_id: string | null; active: boolean }

function validDate(s: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

export async function GET(request: Request) {
  return handle(async () => {
    if (getServerSupabaseConfig().environment !== 'homologacao') {
      throw new ApiError(404, 'Conferência disponível somente na homologação.')
    }
    const access = await authorizeClickDeskSessionClient(request)
    if (!access.isManagement) throw new ApiError(403, 'Leitura complementar restrita à gestão.')

    const params = new URL(request.url).searchParams
    if ([...params.keys()].some(key=>!['start','end','team_id'].includes(key)||params.getAll(key).length!==1)) {
      throw new ApiError(400, 'Filtros inválidos.')
    }
    const start=params.get('start')??''
    const end=params.get('end')??''
    const teamId=params.get('team_id')
    if (!validDate(start)||!validDate(end)||start>end ||
        (Date.parse(end)-Date.parse(start))/86400000>92) throw new ApiError(400,'Período inválido.')
    if(teamId&&!/^[0-9a-f-]{36}$/i.test(teamId))throw new ApiError(400,'Equipe inválida.')

    const [peopleResult] = await Promise.all([
      access.admin.from('chat_analysts').select('id,name,team_id,active'),
    ])
    if(peopleResult.error)throw new ApiError(503,'Cadastro de analistas indisponível.')
    const people=(peopleResult.data??[]) as Analyst[]
    const roster=new Map(people.filter(p=>!teamId||p.team_id===teamId).map(p=>[p.id,p]))
    const contributions: Contribution[]=[]
    for(let offset=0;offset<20000;offset+=500) {
      const {data,error}=await access.admin.from('clickdesk_chat_verified_contributions')
        .select('ticket_id,analyst_id,rating_attribution,satisfaction_label')
        .gte('occurred_date',start).lte('occurred_date',end)
        .order('ticket_id',{ascending:true})
        .order('analyst_id',{ascending:true})
        .range(offset,offset+499)
      if(error)throw new ApiError(503,'Contribuições verificadas indisponíveis.')
      const page=(data??[]) as Contribution[]
      contributions.push(...page)
      if(page.length<500)break
      if(offset+500>=20000)throw new ApiError(422,'Limite de paginação da conferência excedido.')
    }

    const contributionIds=new Map<string,Set<string>>()
    const ratedByTicket=new Map<string,Array<{analyst_id:string;label:'positive'|'negative'}>>()
    for(const row of contributions) {
      if(!row.analyst_id||!roster.has(row.analyst_id))continue
      const set=contributionIds.get(row.analyst_id)??new Set<string>()
      set.add(row.ticket_id)
      contributionIds.set(row.analyst_id,set)
      if(row.rating_attribution==='last_public_human_answer'
        && (row.satisfaction_label==='positive'||row.satisfaction_label==='negative')) {
        const existing=ratedByTicket.get(row.ticket_id)??[]
        existing.push({analyst_id:row.analyst_id,label:row.satisfaction_label})
        ratedByTicket.set(row.ticket_id,existing)
      }
    }
    const reviews=new Map<string,{positive:number;negative:number}>()
    let conflictingReviewedTickets=0
    for(const entries of ratedByTicket.values()) {
      const unique=new Set(entries.map(e=>e.analyst_id+':'+e.label))
      if(unique.size!==1){conflictingReviewedTickets++;continue}
      const item=entries[0]
      const current=reviews.get(item.analyst_id)??{positive:0,negative:0}
      current[item.label]++
      reviews.set(item.analyst_id,current)
    }
    const analysts=people.filter(p=>roster.has(p.id)).map(person=>{
      const participations=contributionIds.get(person.id)?.size??0
      const r=reviews.get(person.id)??{positive:0,negative:0}
      const evaluated=r.positive+r.negative
      return {
        analyst_id:person.id,analyst_name:person.name,team_id:person.team_id,active:person.active,
        distinct_tickets_with_human_contribution:participations,
        positive_reviews_with_last_human_evidence:r.positive,
        negative_reviews_with_last_human_evidence:r.negative,
        evaluated_with_last_human_evidence:evaluated,
      }
    }).filter(row=>row.distinct_tickets_with_human_contribution||row.evaluated_with_last_human_evidence)
      .sort((a,b)=>b.distinct_tickets_with_human_contribution-a.distinct_tickets_with_human_contribution)
    return json({
      source:'clickdesk_verified_contributions',period:{start,end},scope:{team_id:teamId},
      status:'complementary_evidence_not_final',
      note:'SOMENTE DIAGNÓSTICO: a captura auxiliar contabiliza participações e avaliações incompletas; não calcular ou comparar CSAT, metas, volume de atendimento ou fechamento com esta fonte. A leitura operacional usa exclusivamente o ledger final.',
      ambiguous_review_tickets:conflictingReviewedTickets,
      analysts,
    })
  })
}

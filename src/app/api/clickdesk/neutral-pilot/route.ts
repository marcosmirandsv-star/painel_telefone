import {isCxCron} from '@/lib/cx360-diagnostics-server'
import {ALLOWLIST,runPilot} from '@/lib/neutral-pilot/pilot-runner'
import {adminClient} from '@/lib/integration-server'

const expectedHashes:Record<string,string>={
 '1101634':'2f1830934411d2fdd27aee8a7de195672c2b4202eccb6259990722f2a37024f5',
 '1099691':'c01b7407d53bf3793f5982853a91c48425fa56e24cb899faa5a2154259bfe661',
 '1099238':'a672c96387ce59d090fc9d6b8f97753f500e7121c02718696ffc3eb8df721941',
 '1098205':'39cc04eecf0e2a0a40e7c93fed533b26650394aa765f0cae8fb7d1569c9d67f6',
 '1098085':'938654c1a86a5c40f8e8f742b98fee5c31cb85e7f29f177f4ed3726f03518997',
}

export const runtime='nodejs'
export const maxDuration=300
export const dynamic='force-dynamic'

/** Manual diagnostic endpoint: exactly one fixed allowlisted ticket, no queue or writes. */
export async function POST(request:Request){
  const headers={'Cache-Control':'no-store'}
  if(!isCxCron(request))return Response.json({error:'unauthorized'},{status:401,headers})
  if(process.env.VERCEL_ENV!=='production'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://qmetbydkepfdgfqkdkai.supabase.co')return Response.json({error:'production_only'},{status:403,headers})
  let input:unknown
  try{input=await request.json()}catch{return Response.json({error:'invalid_request'},{status:400,headers})}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!('ticket_id' in input)||typeof input.ticket_id!=='string'||!ALLOWLIST.some(x=>x.id===input.ticket_id))return Response.json({error:'ticket_not_allowlisted'},{status:400,headers})
  try{
    const admin=adminClient(),spec=ALLOWLIST.find(x=>x.id===input.ticket_id)!
    const snapshot=async()=>{
      const [review,rating]=await Promise.all([
        admin.from('clickdesk_neutral_reviews').select('source_hash,status,attempts').eq('ticket_id',spec.id).maybeSingle(),
        admin.from('clickdesk_event_ratings').select('source_hash,original_label,rated_at').eq('ticket_id',spec.id).maybeSingle(),
      ])
      return !review.error&&!rating.error&&review.data?.status==='pending'&&review.data.attempts===0
        &&review.data.source_hash===expectedHashes[spec.id]&&rating.data?.source_hash===expectedHashes[spec.id]
        &&rating.data.original_label==='Neutro'&&Date.parse(rating.data.rated_at)===Date.parse(spec.ratedAt)
    }
    if(!await snapshot())return Response.json({error:'source_changed_or_not_pending'},{status:409,headers})
    const result=await runPilot({env:process.env,ticketIds:[input.ticket_id]})
    if(!await snapshot())return Response.json({error:'source_changed_during_diagnostic'},{status:409,headers})
    return Response.json(result,{headers})
  }catch{return Response.json({error:'diagnostic_unavailable',database_mutations:0},{status:503,headers})}
}

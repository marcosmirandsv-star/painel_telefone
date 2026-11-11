const object=(x:unknown):Record<string,any>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{}
const text=(x:unknown)=>typeof x==='string'||typeof x==='number'?String(x):''
const unwrap=(p:unknown)=>{const value=object(p);return object(value.ticket||value.data||value)}
export async function readTicketHistory(id: string, get: (path:string)=>Promise<unknown>) {
  const ticketRequest = get('/tickets/'+encodeURIComponent(id))
  async function collection(kind:'messages'|'events') {
    const result: unknown[] = [], seen = new Set<string>()
    for (let page=1;page<=50;page++) {
      const raw=await get('/tickets/'+encodeURIComponent(id)+'/'+kind+'?page='+page+'&per_page=200')
      const payload=object(raw)
      const inner=object(payload.data)
      const values=Array.isArray(raw)?raw:payload[kind] ?? inner[kind] ?? payload.data
      if (!Array.isArray(values)) return { records:result, complete:false }
      const signature=JSON.stringify(values.map(v=>text(object(v).id)))
      if (values.length && seen.has(signature)) return { records:result, complete:false }
      seen.add(signature);result.push(...values)
      const lastPage=Number(payload.last_page || object(payload.meta).last_page || inner.last_page)
      if (Number.isFinite(lastPage) && lastPage>=page) {
        if(page===lastPage)return {records:result,complete:true}
      } else if(values.length<200)return {records:result,complete:true}
    }
    return {records:result,complete:false}
  }
  const [ticketPayload,messages,events]=await Promise.all([ticketRequest,collection('messages'),collection('events')])
  const ticket=unwrap(ticketPayload)
  if(text(ticket.id)!==id)return {ticket,messages:[],events:[],complete:false}
  const embedded=Array.isArray(ticket.messages)?ticket.messages:[]
  const fetched=new Set(messages.records.map(m=>text(object(m).id)))
  // Detail can expose later records omitted by /messages. Never credit a truncated history.
  const detailMatches=Array.isArray(ticket.messages) && embedded.every(m=>fetched.has(text(object(m).id)))
  if(events.complete && embedded.length>messages.records.length && messages.records.length>=200) {
    // The messages endpoint can ignore page and cap results at 200. Accept
    // the full detail only when a separately generated transcript corroborates
    // every message timestamp, human author and visibility, in the same order.
    const ids=embedded.map(value=>text(object(value).id))
    const unique=ids.every(Boolean)&&new Set(ids).size===ids.length
    const byId=new Map(embedded.map(value=>[text(object(value).id),object(value)]))
    const author=(m:Record<string,unknown>)=>text(object(m.author).name||m.author_name||(typeof m.author==='string'?m.author:'')).normalize('NFKC').trim().toLowerCase()
    const consistent=messages.records.every(value=>{
      const m=object(value),d=byId.get(text(m.id))
      return d&&text(d.created_at||d.timestamp)===text(m.created_at||m.timestamp)&&author(d)===author(m)&&text(d.visibility)===text(m.visibility)&&text(d.author_type)===text(m.author_type)
    })
    if(unique&&consistent) {
      const raw=await get('/tickets/'+encodeURIComponent(id)+'/transcript')
      const transcript=typeof raw==='string'?raw:text(object(raw).transcript||object(raw).text)
      const headers=Array.from(transcript.matchAll(/^\[(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2})\] ([^\r\n]+):\s*$/gm))
      const corroborated=headers.length===embedded.length&&embedded.every((value,index)=>{
        const m=object(value),header=headers[index],at=new Date(text(m.created_at||m.timestamp))
        if(!Number.isFinite(at.getTime()))return false
        const iso=at.toISOString(),stamp=iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4)+' '+iso.slice(11,16)
        const internal=['private','internal'].includes(text(m.visibility).toLowerCase())||m.public===false||m.is_public===false
        if(header[1]!==stamp||internal!==/ \[nota interna\]$/i.test(header[2]))return false
        return text(m.author_type||object(m.author).type).toLowerCase()!=='agent'||Boolean(author(m)&&author(m)===header[2].replace(/ \[nota interna\]$/i,'').normalize('NFKC').trim().toLowerCase())
      })
      if(corroborated)return {ticket,messages:embedded,events:events.records,complete:true,history_source:'detail_and_transcript'}
    }
  }
  return { ticket, messages:messages.records, events:events.records,
    complete:messages.complete && events.complete && detailMatches }
}

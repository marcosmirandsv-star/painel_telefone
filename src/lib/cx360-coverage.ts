export type CxCapture={start_date:string;end_date:string;status:string;created_at:string;imported?:number}
/** Captures can overlap; a day must have an actual complete capture, never an inferred gap. */
export function composeCxCoverage(start:string,end:string,runs:CxCapture[]) {
 const complete=runs.filter(r=>r.status==='complete'&&Number.isFinite(Date.parse(r.created_at))).sort((a,b)=>b.created_at.localeCompare(a.created_at))
 const selected=new Map<string,CxCapture>(),missing:string[]=[]
 for(let day=start;day<=end;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10)){
  const capture=complete.find(r=>r.start_date<=day&&r.end_date>=day)
  if(capture)selected.set(capture.created_at+':'+capture.start_date+':'+capture.end_date,capture);else missing.push(day)
 }
 const chosen=[...selected.values()]
 if(missing.length||!chosen.length)return {status:'incomplete',created_at:null,composed:false,captures:chosen.length,missing_days:missing}
 return {status:'complete',created_at:chosen.map(r=>r.created_at).sort()[0],composed:chosen.length>1,captures:chosen.length,missing_days:[] as string[]}
}

import { chatPeriodBounds } from './chat-presentation.ts'
import { publishedClickDeskEnd } from './clickdesk-publication.ts'
export type ChatTimeMode = 'month' | 'week' | 'day'
export function chatTimeRange(month:string,mode:ChatTimeMode,reference:string,now=new Date()) {
 const bounds=chatPeriodBounds(month), end=publishedClickDeskEnd(bounds.end,now)
 if(end<bounds.start)return {start:bounds.start,end}
 const valid=/^20\d{2}-\d{2}-\d{2}$/.test(reference)&&Number.isFinite(Date.parse(reference))&&new Date(reference).toISOString().slice(0,10)===reference
 const anchor=valid&&reference>=bounds.start&&reference<=end?reference:end
 if(mode==='month')return {start:bounds.start,end}
 if(mode==='day')return {start:anchor,end:anchor}
 const day=new Date(anchor+'T12:00:00Z'), weekday=(day.getUTCDay()+6)%7
 const monday=new Date(day.getTime()-weekday*86400000).toISOString().slice(0,10)
 const sunday=new Date(Date.parse(monday+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)
 return {start:monday<bounds.start?bounds.start:monday,end:sunday>end?end:sunday}
}

import type { Evidence } from './cx360-diagnostics'
/** Constrains format and references; semantic validation remains mandatory after generation. */
export function diagnosisSchema(messages:Evidence[]) {
 const text={type:'string',minLength:5,maxLength:1800}
 const fields=['observation','hypothesis','impact','behavior','practice','suggested_phrase','verification']
 const reference={type:'string',...(messages.length<=80?{enum:messages.map(m=>m.id)}:{description:'ID exato de mensagem presente no histórico; será validado no servidor.'})}
 return {type:'object',additionalProperties:false,required:['factor','confidence',...fields,'human_gap','human_gap_evidence_ids','limitations','evidence_ids'],properties:{
  factor:{type:'string',enum:['produto','operacao','externo','conducao','misto','inconclusivo']},
  confidence:{type:'string',enum:['baixa','media','alta']},
  ...Object.fromEntries(fields.map(key=>[key,text])),
  human_gap:{type:['string','null'],maxLength:1800},
  human_gap_evidence_ids:{type:'array',maxItems:4,items:reference},
  limitations:{type:'array',maxItems:6,items:{type:'string',maxLength:1800}},
  evidence_ids:{type:'array',minItems:1,maxItems:4,items:reference}
 }}
}

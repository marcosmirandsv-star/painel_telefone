import {qualitativeAnalysisVersion,QUALITATIVE_ANALYSIS_VERSION} from './clickdesk-qualitative.ts'

export type QualitativeDisplayIdentity={analyst_id:string|null;occurred_date:string|null;satisfaction_label:string|null}
export type QualitativeDisplayCache=QualitativeDisplayIdentity&{analysis:unknown;validation_status:string|null}
/** Read-only policy: a visible analysis never authorizes generation or changes human review. */
export function qualitativeDisplayStatus(cache:QualitativeDisplayCache|null,identity:QualitativeDisplayIdentity,isManagement=false){
 if(!cache||cache.analyst_id!==identity.analyst_id||cache.occurred_date!==identity.occurred_date||cache.satisfaction_label!==identity.satisfaction_label)return 'unavailable' as const
 if(!cache.analysis||typeof cache.analysis!=='object'||Array.isArray(cache.analysis))return 'unavailable' as const
 if(cache.validation_status==='rejected')return isManagement?'rejected':'unavailable'
 if(cache.validation_status==='approved')return 'approved' as const
 if(cache.validation_status==='pending'&&qualitativeAnalysisVersion(cache.analysis)>=QUALITATIVE_ANALYSIS_VERSION)return 'preliminary' as const
 return 'unavailable' as const
}

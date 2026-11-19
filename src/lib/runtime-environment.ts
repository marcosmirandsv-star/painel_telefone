import {isChatProductionEnabled} from './chat-production-gate'

// Only the new Chat routes use this module. Existing Phone/CX helpers stay unchanged.
export function getServerSupabaseConfig() {
 const enabled=isChatProductionEnabled()
 return {
  url:enabled?'https://qmetbydkepfdgfqkdkai.supabase.co':'',
  publishableKey:enabled?process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY??'':'',
  serviceRoleKey:enabled?process.env.SUPABASE_SERVICE_ROLE_KEY??'':'',
  environment:'producao' as 'producao'|'homologacao',
 }
}

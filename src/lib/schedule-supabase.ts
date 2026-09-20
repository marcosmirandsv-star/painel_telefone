import { createClient } from '@supabase/supabase-js'

const scheduleSupabaseUrl =
  process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_URL ??
  'https://homologacao-nao-configurada.supabase.co'

const scheduleSupabasePublishableKey =
  process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY ??
  'homologacao-nao-configurada'

export const scheduleSupabase = createClient(
  scheduleSupabaseUrl,
  scheduleSupabasePublishableKey,
)

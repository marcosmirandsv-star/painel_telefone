import { createClient } from '@supabase/supabase-js'

const scheduleSupabaseUrl =
  process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_URL ??
  'https://vvtorcvchnqhcredhorv.supabase.co'

const scheduleSupabasePublishableKey =
  process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_mqTX2u1bJ69dNKWD0lO-iw_p2Wa9B2t'

export const scheduleSupabase = createClient(
  scheduleSupabaseUrl,
  scheduleSupabasePublishableKey,
)

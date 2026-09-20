import { createClient } from '@supabase/supabase-js'

const scheduleSupabaseUrl = process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_URL!
const scheduleSupabasePublishableKey = process.env.NEXT_PUBLIC_SCHEDULE_SUPABASE_PUBLISHABLE_KEY!

export const scheduleSupabase = createClient(
  scheduleSupabaseUrl,
  scheduleSupabasePublishableKey,
)

import { createClient } from '@supabase/supabase-js'
import { getBrowserSupabaseConfig } from '@/lib/runtime-environment'

const { url, publishableKey } = getBrowserSupabaseConfig()

if (!url || !publishableKey) {
  throw new Error('Supabase não configurado para este ambiente.')
}

export const supabase = createClient(url, publishableKey)

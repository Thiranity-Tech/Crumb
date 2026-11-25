import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://hrswspaspuaxzowhxvcd.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_YDbWbPQN4PgLUH7LxDiMRg_txdxRsny'

export const configured = Boolean(url && key && url.includes('supabase'))
export const supabase = configured ? createClient(url, key) : null

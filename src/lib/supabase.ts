import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * O app usa dados simulados enquanto as variáveis não estiverem configuradas.
 * Para conectar: copie .env.example para .env e execute o schema em /supabase/schema.sql.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null
export const isDemoMode = !supabase

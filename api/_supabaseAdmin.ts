import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Compatibilité avec le code existant qui appelle getSupabaseAdmin()
export function getSupabaseAdmin() {
  return supabaseAdmin;
}

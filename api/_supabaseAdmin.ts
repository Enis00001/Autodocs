import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase "admin" pour routes serverless. Utilise la service role
 * key (secret) qui bypass les policies RLS. À n'utiliser QUE côté serveur.
 *
 * Variables d'env requises côté Vercel :
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase admin non configuré : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

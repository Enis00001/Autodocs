/**
 * Helpers Supabase serveur-side, partagés entre toutes les routes API.
 *
 * - `getSupabaseAdmin()` : client avec la SERVICE_ROLE_KEY (bypass RLS).
 *   À utiliser pour toute écriture/lecture transversale (signature_requests,
 *   abonnements, brouillons d'autres users, etc.).
 *
 * - `getAuthUserId(req)` : valide le JWT Supabase passé en `Authorization`
 *   et renvoie l'user.id. Renvoie null si invalide.
 *
 * - `getPublicAppUrl(req)` : URL publique du déploiement (utilisée pour
 *   construire les liens dans les emails). Préfère `PUBLIC_APP_URL`
 *   ou `VERCEL_URL` si présent, sinon dérive depuis l'en-tête host.
 */
import type { VercelRequest } from "@vercel/node";

const FALLBACK_APP_URL = "https://autodocs-eight.vercel.app";

export function getSupabaseUrl(): string | null {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
}

export function getSupabaseAnonKey(): string | null {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;
}

export async function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Configuration Supabase incomplète côté serveur (URL ou SERVICE_ROLE_KEY).");
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key);
}

export async function getAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;

  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Construit l'URL publique de l'app pour les emails.
 * Ordre de priorité :
 *   1. process.env.PUBLIC_APP_URL (config explicite)
 *   2. process.env.VERCEL_URL    (déploiement preview/prod)
 *   3. en-tête `host` de la requête (fallback ultime)
 *   4. URL de prod hard-codée
 */
export function getPublicAppUrl(req?: VercelRequest): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  if (req) {
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined);
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    if (host) return `${proto}://${host}`;
  }

  return FALLBACK_APP_URL;
}

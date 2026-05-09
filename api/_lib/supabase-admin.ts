import type { VercelRequest } from "@vercel/node";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Helpers Supabase pour les routes API serverless (`api/*.ts`).
 *
 * Le préfixe `_` du dossier indique à Vercel de NE PAS déployer ce fichier
 * comme une fonction serverless ; il est seulement importable depuis les
 * autres routes via `import { ... } from "./_lib/supabase-admin.js"`.
 *
 * Important :
 *  - On NE lit JAMAIS de variables `VITE_*` côté serveur. Elles n'existent
 *    pas en runtime serverless (Vercel n'expose au front que ce qui est
 *    préfixé `VITE_` au build), et leur présence ici est trompeuse.
 *  - On garde un *fallback* pour `SUPABASE_URL` uniquement vers
 *    `VITE_SUPABASE_URL` parce que c'est *publique* (URL du projet) et
 *    pour conserver la compat avec les déploiements existants.
 *  - `SUPABASE_SERVICE_ROLE_KEY` est OBLIGATOIRE et n'a JAMAIS de fallback.
 */

const SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";

function getSupabaseUrlOrThrow(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (!url) {
    throw new Error(
      "Configuration Supabase manquante : SUPABASE_URL n'est pas définie côté serveur (Vercel → Settings → Environment Variables).",
    );
  }
  return url;
}

function getSupabaseAnonKeyOrThrow(): string {
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!key) {
    throw new Error(
      "Configuration Supabase manquante : SUPABASE_ANON_KEY n'est pas définie côté serveur.",
    );
  }
  return key;
}

function getServiceRoleKeyOrThrow(): string {
  const key = process.env[SERVICE_ROLE_ENV];
  if (!key) {
    throw new Error(
      `Configuration Supabase manquante : ${SERVICE_ROLE_ENV} n'est pas définie côté serveur. Ajoutez-la dans Vercel → Settings → Environment Variables (Production + Preview), puis redéployez.`,
    );
  }
  if (key.startsWith("VITE_") || key.length < 50) {
    throw new Error(
      `${SERVICE_ROLE_ENV} semble invalide (longueur ${key.length}). Vérifiez que vous avez bien copié la "service_role" key depuis Supabase → Project Settings → API.`,
    );
  }
  return key;
}

/**
 * Client Supabase ADMIN (service_role) — bypass RLS.
 * À utiliser UNIQUEMENT depuis `api/*.ts`. Le throw est volontaire :
 * faire échouer la route avec un message lisible vaut mieux qu'un
 * `TypeError: Failed to fetch` côté client.
 */
export async function getSupabaseAdmin(): Promise<SupabaseClient> {
  const url = getSupabaseUrlOrThrow();
  const key = getServiceRoleKeyOrThrow();
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client Supabase ANON (clé publique) — utile uniquement pour valider
 * un JWT utilisateur via `auth.getUser(token)`. NE PAS utiliser pour
 * lire/écrire des données sensibles depuis une route API.
 */
export async function getSupabaseAuthClient(): Promise<SupabaseClient> {
  const url = getSupabaseUrlOrThrow();
  const anon = getSupabaseAnonKeyOrThrow();
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Extrait l'`auth.uid()` à partir du header `Authorization: Bearer <jwt>`.
 * Retourne `null` si l'en-tête est absent / le token invalide. NE THROW PAS :
 * laisser le caller décider si la route exige une auth ou non.
 */
export async function getAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;
  try {
    const supabase = await getSupabaseAuthClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch (err) {
    console.error("[supabase-admin] getAuthUserId failed:", err);
    return null;
  }
}

const FALLBACK_APP_URL = "https://autodocs-eight.vercel.app";

/**
 * Calcule l'URL publique de l'app, dans cet ordre :
 *  1. `PUBLIC_APP_URL` (env var explicite — recommandé en prod)
 *  2. en-têtes `x-forwarded-host` / `host` de la requête (si dispo)
 *  3. `VERCEL_URL` (URL automatique du déploiement)
 *  4. fallback hardcodé.
 */
export function getPublicAppUrl(req?: VercelRequest): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (req) {
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined);
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    if (host) return `${proto}://${host}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return FALLBACK_APP_URL;
}

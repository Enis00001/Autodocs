import { supabase } from "@/lib/supabase";

export type SignupPlan = "monthly" | "annual" | null;

export function getSignupEmailRedirectTo(plan: SignupPlan = null): string {
  const redirectUrl = new URL(plan ? "/abonnement" : "/app", window.location.origin);
  if (plan) redirectUrl.searchParams.set("plan", plan);
  return redirectUrl.toString();
}

/**
 * @deprecated Préférez `useAuth().concessionId` pour le périmètre métier,
 * ou `getCurrentConcessionId()` pour isoler les données par concession.
 * `user.id` reste utile pour `created_by` / traçabilité auteur.
 */
/**
 * @deprecated Préférez `useAuth().concessionId` pour le périmètre métier,
 * ou `getCurrentConcessionId()` pour isoler les données par concession.
 * `user.id` reste utile pour `created_by` et la traçabilité auteur.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("getCurrentUserId:", error);
    return null;
  }
  return data.user?.id ?? null;
}

/** `is_admin` dans `raw_user_meta_data` / `user_metadata` (compte support / interne). */
export async function getCurrentUserIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return false;
  return data.user.user_metadata?.is_admin === true;
}

/**
 * Récupère la `concession_id` du user connecté en interrogeant
 * `membres_concession`. Préférer `useAuth().concessionId` côté React ;
 * cet helper est destiné aux modules non-React (utils legacy, scripts).
 *
 * Retourne `null` si le user n'est rattaché à aucune concession active
 * (cas post-signup avant bootstrap, ou compte support).
 */
export async function getCurrentConcessionId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("membres_concession")
    .select("concession_id")
    .eq("user_id", userId)
    .eq("actif", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getCurrentConcessionId:", error);
    return null;
  }
  return (data?.concession_id as string | undefined) ?? null;
}

/**
 * Récupère le rôle ('admin' | 'commercial') du user dans sa concession active.
 * Retourne 'commercial' par défaut si non trouvé (mode safe).
 */
export async function getCurrentMembreRole(): Promise<"admin" | "commercial"> {
  const userId = await getCurrentUserId();
  if (!userId) return "commercial";
  const { data, error } = await supabase
    .from("membres_concession")
    .select("role")
    .eq("user_id", userId)
    .eq("actif", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return "commercial";
  return data.role === "admin" ? "admin" : "commercial";
}

import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

export type AbonnementPlan = "gratuit" | "pro";

export type AbonnementInfo = {
  plan: AbonnementPlan;
  bonsCeMois: number;
  quota: number; // 10 en gratuit, Infinity en pro (on renverra Number.POSITIVE_INFINITY)
  dateRenouvellement: string | null;
  actif: boolean;
};

export const QUOTA_GRATUIT = 10;

/**
 * Charge l'abonnement courant de l'utilisateur. Si aucune ligne n'existe
 * encore (nouveau compte), on renvoie les valeurs par défaut (gratuit, 0 bons).
 */
export async function loadAbonnement(): Promise<AbonnementInfo | null> {
  const uid = await getCurrentUserId();
  if (!uid) return null;

  const { data, error } = await supabase
    .from("abonnements")
    .select("plan, bons_ce_mois, date_renouvellement, actif")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) {
    console.error("loadAbonnement:", error);
    return {
      plan: "gratuit",
      bonsCeMois: 0,
      quota: QUOTA_GRATUIT,
      dateRenouvellement: null,
      actif: true,
    };
  }

  const plan: AbonnementPlan = data?.plan === "pro" ? "pro" : "gratuit";
  return {
    plan,
    bonsCeMois: (data?.bons_ce_mois as number | undefined) ?? 0,
    quota: plan === "pro" ? Number.POSITIVE_INFINITY : QUOTA_GRATUIT,
    dateRenouvellement: (data?.date_renouvellement as string | null) ?? null,
    actif: data?.actif ?? true,
  };
}

export type CheckoutInterval = "monthly" | "annual";

/**
 * Appelle la route /api/create-checkout. Redirige vers la page de paiement
 * Stripe en cas de succès.
 *
 * @param interval "monthly" (49 €/mois, défaut) ou "annual" (399 €/an).
 */
export async function startCheckout(
  interval: CheckoutInterval = "monthly",
): Promise<void> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("Utilisateur non connecté.");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const res = await fetch("/api/create-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: uid, email: user?.email, interval }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || "Impossible de démarrer le paiement.");
  }
  const { url } = (await res.json()) as { url?: string };
  if (!url) throw new Error("URL de paiement manquante.");
  window.location.assign(url);
}

/**
 * Appelle /api/increment-bons. Retourne l'état mis à jour si autorisé,
 * sinon lève une erreur avec code `quota_reached`.
 */
export async function consumeBonQuota(): Promise<{
  plan: AbonnementPlan;
  bonsCeMois: number;
}> {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error("Utilisateur non connecté.");

  const res = await fetch("/api/increment-bons", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: uid }),
  });

  if (res.status === 402) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      plan?: AbonnementPlan;
      bonsCeMois?: number;
      quota?: number;
    };
    const err = new Error("Limite mensuelle atteinte.") as Error & {
      code?: string;
      info?: typeof payload;
    };
    err.code = "quota_reached";
    err.info = payload;
    throw err;
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || "Impossible de vérifier votre quota.");
  }
  const data = (await res.json()) as { plan?: string; bonsCeMois?: number };
  return {
    plan: data.plan === "pro" ? "pro" : "gratuit",
    bonsCeMois: data.bonsCeMois ?? 0,
  };
}

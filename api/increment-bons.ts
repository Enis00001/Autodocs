import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/increment-bons
 *
 * Body JSON : { userId: string }
 * Retourne :
 *   200 { plan, bonsCeMois, quota, allowed: true } si OK
 *   402 { error, plan, bonsCeMois, quota }         si quota atteint
 *
 * Vérifie le quota de l'utilisateur (10 bons/mois en plan gratuit,
 * illimité en plan pro) et incrémente `bons_ce_mois` côté serveur. Appelé
 * par le front juste avant la génération PDF.
 */
const QUOTA_GRATUIT = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (req.body ?? {}) as { userId?: string };
  const userId = body.userId;
  if (!userId) return res.status(400).json({ error: "userId requis" });

  // Client Supabase admin inlined (évite un import local qui n'est pas
  // bundlé dans /var/task/ par Vercel).
  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // On récupère (ou crée) la ligne d'abonnement.
  const { data: existing } = await supabaseAdmin
    .from("abonnements")
    .select("plan, bons_ce_mois, actif")
    .eq("user_id", userId)
    .maybeSingle();

  const plan = (existing?.plan as string) || "gratuit";
  const bonsCeMois = (existing?.bons_ce_mois as number) ?? 0;
  const quota = plan === "pro" ? Infinity : QUOTA_GRATUIT;

  if (plan !== "pro" && bonsCeMois >= QUOTA_GRATUIT) {
    return res.status(402).json({
      error: "quota_reached",
      plan,
      bonsCeMois,
      quota: QUOTA_GRATUIT,
    });
  }

  const nextCount = bonsCeMois + 1;

  if (!existing) {
    await supabaseAdmin.from("abonnements").insert({
      user_id: userId,
      plan: "gratuit",
      bons_ce_mois: nextCount,
    });
  } else {
    await supabaseAdmin
      .from("abonnements")
      .update({
        bons_ce_mois: nextCount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  }

  return res.status(200).json({
    allowed: true,
    plan,
    bonsCeMois: nextCount,
    quota: quota === Infinity ? null : quota,
  });
}

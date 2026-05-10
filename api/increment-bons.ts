import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getActiveConcessionIdForUser,
  getMembreRoleForConcession,
} from "./_lib/concession.js";

/**
 * POST /api/increment-bons
 *
 * Headers : Authorization: Bearer <access_token>
 * Body JSON : { concessionId: string }
 * Retourne :
 *   200 { plan, bonsTotal, quota, allowed: true } si OK
 *   200 { ..., adminBypass: true } si compte admin (sans incrément)
 *   401 si JWT manquant ou invalide
 *   403 si la concession ne correspond pas au JWT ou au corps
 *   402 { error, plan, bonsTotal, quota } si quota atteint
 *
 * Le quota est partagé au niveau de la concession (plan gratuit vs pro).
 */
const QUOTA_GRATUIT = 10;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  const token =
    typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Authorization Bearer requis" });
  }

  const body = (req.body ?? {}) as { concessionId?: string };
  const concessionIdBody =
    typeof body.concessionId === "string" ? body.concessionId.trim() : "";
  if (!concessionIdBody) return res.status(400).json({ error: "concessionId requis" });

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: "Session invalide" });
  }
  const userId = userData.user.id;

  const concessionFromJwt = await getActiveConcessionIdForUser(supabaseAdmin, userId);
  if (!concessionFromJwt || concessionFromJwt !== concessionIdBody) {
    return res.status(403).json({ error: "concessionId incompatible avec la session" });
  }

  const roleInConcession = await getMembreRoleForConcession(
    supabaseAdmin,
    userId,
    concessionIdBody,
  );
  if (!roleInConcession) {
    return res.status(403).json({ error: "Accès concession refusé" });
  }

  const isAdmin = userData.user.user_metadata?.is_admin === true;

  const { data: existing } = await supabaseAdmin
    .from("abonnements")
    .select("id, plan, bons_total, actif")
    .eq("concession_id", concessionIdBody)
    .maybeSingle();

  const plan = (existing?.plan as string) || "gratuit";
  const bonsTotal = (existing?.bons_total as number) ?? 0;
  const quota = plan === "pro" ? Infinity : QUOTA_GRATUIT;

  if (isAdmin) {
    return res.status(200).json({
      allowed: true,
      adminBypass: true,
      plan,
      bonsTotal,
      quota: quota === Infinity ? null : quota,
    });
  }

  if (plan !== "pro" && bonsTotal >= QUOTA_GRATUIT) {
    return res.status(402).json({
      error: "quota_reached",
      plan,
      bonsTotal,
      quota: QUOTA_GRATUIT,
    });
  }

  const nextCount = bonsTotal + 1;

  if (!existing?.id) {
    await supabaseAdmin.from("abonnements").insert({
      concession_id: concessionIdBody,
      user_id: userId,
      plan: "gratuit",
      bons_total: nextCount,
    });
  } else {
    await supabaseAdmin
      .from("abonnements")
      .update({
        bons_total: nextCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  }

  return res.status(200).json({
    allowed: true,
    plan,
    bonsTotal: nextCount,
    quota: quota === Infinity ? null : quota,
  });
}

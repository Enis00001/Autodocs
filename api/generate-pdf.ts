import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildHtml, renderPdfFromHtml } from "./_lib/bon-template";

const QUOTA_GRATUIT = 10;

/**
 * Vérifie le JWT Supabase passé dans l'en-tête Authorization.
 * Renvoie l'user id si valide, null sinon. Inliné (pas d'import local) pour
 * éviter les soucis de bundling Vercel.
 */
async function requireAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Vérifie le quota gratuit à vie et incrémente `bons_total` côté serveur.
 * Renvoie `{ ok: true }` si autorisé, sinon `{ ok: false, error }` avec
 * le code HTTP à renvoyer.
 */
async function checkAndConsumeQuota(
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return {
      ok: false,
      status: 500,
      body: { error: "Configuration Supabase incomplète côté serveur." },
    };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: existing } = await admin
    .from("abonnements")
    .select("plan, bons_total")
    .eq("user_id", userId)
    .maybeSingle();

  const plan = (existing?.plan as string) || "gratuit";
  const bonsTotal = (existing?.bons_total as number) ?? 0;

  if (plan !== "pro" && bonsTotal >= QUOTA_GRATUIT) {
    return {
      ok: false,
      status: 429,
      body: {
        error: "Limite atteinte — passez au Pro pour des bons illimités.",
        code: "quota_reached",
        plan,
        bonsTotal,
        quota: QUOTA_GRATUIT,
      },
    };
  }

  const nextCount = bonsTotal + 1;
  if (!existing) {
    await admin.from("abonnements").insert({
      user_id: userId,
      plan: "gratuit",
      bons_total: nextCount,
    });
  } else {
    await admin
      .from("abonnements")
      .update({ bons_total: nextCount, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return { ok: true };
}

/* ================================================================== */
/*  Main handler                                                       */
/* ================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await requireAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const shouldBypassQuota =
    process.env.NODE_ENV === "development" || process.env.BYPASS_QUOTA === "true";

  if (!shouldBypassQuota) {
    const quota = await checkAndConsumeQuota(userId);
    if (!quota.ok) {
      return res.status(quota.status).json(quota.body);
    }
  }

  let body: Record<string, unknown>;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else {
    body = req.body ?? {};
  }

  const formData = (body.formData ?? body) as Record<string, string>;
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }

  try {
    const html = buildHtml(formData);
    const pdfBuffer = await renderPdfFromHtml(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-pdf] Error during HTML/PDF generation:", err);
    return res.status(500).json({ error: message || "Erreur lors de la génération du PDF" });
  }
}

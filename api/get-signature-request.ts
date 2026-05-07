import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSupabaseAdmin } from "./_lib/supabase-admin";

/**
 * GET /api/get-signature-request?token=...
 *
 * Endpoint PUBLIC (sans authentification) qui sert de back-end à la page
 * /signer/:token. Renvoie les infos non-sensibles + le PDF (déjà signé par
 * le vendeur) pour permettre l'aperçu côté client.
 *
 * On ne renvoie JAMAIS les autres champs de la table (form_data peut
 * contenir des infos sensibles, mais c'est nécessaire pour reconstruire
 * le PDF final côté serveur via complete-signature.ts ; ici on ne renvoie
 * que ce dont la page front a besoin).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = String(req.query.token ?? "").trim();
  if (!token) {
    return res.status(400).json({ error: "token requis" });
  }

  try {
    const admin = await getSupabaseAdmin();
    const { data, error } = await admin
      .from("signature_requests")
      .select(
        "token, brouillon_id, client_email, client_nom, client_prenom, vendeur_nom, vehicule_modele, pdf_base64, signed_at, expires_at, created_at",
      )
      .eq("token", token)
      .maybeSingle();

    if (error) {
      console.error("[get-signature-request] error:", error);
      return res.status(500).json({ error: "Erreur de lecture" });
    }
    if (!data) {
      return res.status(404).json({ error: "Demande de signature introuvable" });
    }

    const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
    const expired = expiresAt ? expiresAt.getTime() < Date.now() : false;

    return res.status(200).json({
      token: data.token,
      clientEmail: data.client_email,
      clientNom: data.client_nom ?? "",
      clientPrenom: data.client_prenom ?? "",
      vendeurNom: data.vendeur_nom ?? "",
      vehiculeModele: data.vehicule_modele ?? "",
      pdfBase64: data.pdf_base64,
      signedAt: data.signed_at,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
      expired,
      alreadySigned: !!data.signed_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    console.error("[get-signature-request] exception:", err);
    return res.status(500).json({ error: message });
  }
}

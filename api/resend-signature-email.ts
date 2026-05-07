import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import {
  getAuthUserId,
  getPublicAppUrl,
  getSupabaseAdmin,
} from "./_lib/supabase-admin";

type ResendBody = {
  brouillonId?: string;
  /** Si fourni, on tente de renvoyer l'email pour ce token précis. */
  token?: string;
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST /api/resend-signature-email
 *
 * Authentifié. Renvoie au client l'email contenant le lien de signature
 * pour le brouillon donné, en réutilisant le token existant si la dernière
 * `signature_request` n'est pas encore expirée ou signée.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  let body: ResendBody = {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as ResendBody;
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as ResendBody;
  }

  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const tokenInput = String(body.token ?? "").trim() || null;

  if (!brouillonId && !tokenInput) {
    return res.status(400).json({ error: "brouillonId ou token requis" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const admin = await getSupabaseAdmin();

  // Cherche la signature_request correspondant à l'utilisateur courant.
  const query = admin
    .from("signature_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenInput) query.eq("token", tokenInput);
  else if (brouillonId) query.eq("brouillon_id", brouillonId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[resend-signature-email] read error:", error);
    return res.status(500).json({ error: "Erreur de lecture" });
  }

  const request = rows?.[0];
  if (!request) {
    return res.status(404).json({ error: "Aucune demande de signature trouvée" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Déjà signé" });
  }

  // Si la requête est expirée, on en crée une nouvelle (avec un nouveau token)
  // en réutilisant le PDF/form_data déjà persistés.
  let token = String(request.token);
  let expiresAt = request.expires_at;
  const isExpired = expiresAt && new Date(expiresAt).getTime() < Date.now();

  if (isExpired) {
    token = crypto.randomUUID();
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("signature_requests").insert({
      token,
      brouillon_id: request.brouillon_id,
      user_id: userId,
      client_email: request.client_email,
      client_nom: request.client_nom,
      client_prenom: request.client_prenom,
      vendeur_email: request.vendeur_email,
      vendeur_nom: request.vendeur_nom,
      vehicule_modele: request.vehicule_modele,
      pdf_base64: request.pdf_base64,
      form_data: request.form_data,
      signature_vendeur: request.signature_vendeur,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("[resend-signature-email] insert error:", insertError);
      return res.status(500).json({ error: "Impossible de régénérer le lien" });
    }
  }

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "AutoDocs <noreply@autodocs.services>";
  const appUrl = getPublicAppUrl(req);
  const signUrl = `${appUrl}/signer/${token}`;

  const clientEmail = String(request.client_email ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Pour rappel, voici le lien permettant de signer votre bon de commande
         pour le véhicule <strong>${escapeHtml(vehiculeModele)}</strong> :</p>
      <p style="margin: 18px 0;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="font-size: 12px; color: #666;">
        Lien valable 7 jours :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a>
      </p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  try {
    const { error: emailErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject: `Rappel : signature du bon de commande — ${vehiculeModele}`,
      html,
      attachments: request.pdf_base64
        ? [{ filename: "bon-de-commande.pdf", content: request.pdf_base64 }]
        : undefined,
    });
    if (emailErr) {
      return res.status(500).json({ error: emailErr.message || "Échec d'envoi email" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec d'envoi email";
    return res.status(500).json({ error: message });
  }

  return res.status(200).json({
    ok: true,
    token,
    signUrl,
    expiresAt,
  });
}

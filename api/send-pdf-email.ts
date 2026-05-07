import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import {
  getAuthUserId,
  getPublicAppUrl,
  getSupabaseAdmin,
} from "./_lib/supabase-admin";

type SendPdfEmailBody = {
  pdfBase64?: string;
  clientEmail?: string;
  clientNom?: string;
  clientPrenom?: string;
  vehiculeModele?: string;
  vendeurNom?: string;
  vendeurEmail?: string;
  /** UUID du brouillon (pour relier la signature_request). */
  brouillonId?: string;
  /** Données du formulaire pour permettre au flow de signature client de
   *  re-rendre le PDF avec les deux signatures. */
  formData?: Record<string, string>;
  /** Signature vendeur (base64 PNG ou data URL). Permet à complete-signature
   *  de re-rendre le PDF final avec les deux signatures. */
  signatureVendeurBase64?: string;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateToken(): string {
  // crypto.randomUUID est dispo côté Node ≥ 14.17 et runtime Vercel.
  return crypto.randomUUID();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  let body: SendPdfEmailBody = {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as SendPdfEmailBody;
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as SendPdfEmailBody;
  }

  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const clientEmail = String(body.clientEmail ?? "").trim();
  const clientNom = String(body.clientNom ?? "").trim();
  const clientPrenom = String(body.clientPrenom ?? "").trim();
  const vehiculeModele = String(body.vehiculeModele ?? "").trim() || "Véhicule";
  const vendeurNom = String(body.vendeurNom ?? "").trim() || "Votre conseiller";
  const vendeurEmail = String(body.vendeurEmail ?? "").trim();
  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const formData =
    body.formData && typeof body.formData === "object" ? body.formData : {};
  const signatureVendeurBase64 = String(body.signatureVendeurBase64 ?? "").trim();

  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 requis" });
  if (!clientEmail || !isValidEmail(clientEmail)) {
    return res.status(400).json({ error: "clientEmail invalide" });
  }

  const userId = await getAuthUserId(req);

  // ---------------------------------------------------------------------------
  // 1) Création de la demande de signature en base.
  // ---------------------------------------------------------------------------
  let signatureToken: string | null = null;
  let expiresAtIso: string | null = null;
  try {
    const admin = await getSupabaseAdmin();
    signatureToken = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expiresAtIso = expiresAt.toISOString();

    const { error } = await admin.from("signature_requests").insert({
      token: signatureToken,
      brouillon_id: brouillonId,
      user_id: userId,
      client_email: clientEmail,
      client_nom: clientNom || null,
      client_prenom: clientPrenom || null,
      vendeur_email: vendeurEmail || null,
      vendeur_nom: vendeurNom,
      vehicule_modele: vehiculeModele,
      pdf_base64: pdfBase64,
      form_data: formData,
      signature_vendeur: signatureVendeurBase64 || null,
      expires_at: expiresAtIso,
    });

    if (error) {
      console.error("[send-pdf-email] insert signature_requests:", error);
      // On continue : on enverra l'email sans lien de signature (mode dégradé).
      signatureToken = null;
      expiresAtIso = null;
    }
  } catch (err) {
    console.error("[send-pdf-email] supabase admin error:", err);
    signatureToken = null;
    expiresAtIso = null;
  }

  // ---------------------------------------------------------------------------
  // 2) Construction du contenu de l'email.
  // ---------------------------------------------------------------------------
  const appUrl = getPublicAppUrl(req);
  const signUrl = signatureToken ? `${appUrl}/signer/${signatureToken}` : null;

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "AutoDocs <noreply@autodocs.services>";
  const subject = `Votre bon de commande — ${vehiculeModele}`;

  const greeting = `Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},`.replace(
    /\s+,$/,
    ",",
  );

  const signCta = signUrl
    ? `
    <div style="margin: 22px 0; padding: 18px; background: #eef0f8; border-left: 4px solid #2c3e8f; border-radius: 6px;">
      <p style="margin: 0 0 12px; font-weight: 600; color: #1a1a2e;">
        Signature électronique
      </p>
      <p style="margin: 0 0 14px; color: #444;">
        Pour signer votre bon de commande, cliquez sur le lien ci-dessous :
      </p>
      <p style="margin: 0 0 8px;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #666;">
        Ou copiez-collez ce lien dans votre navigateur :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a><br>
        <span style="color: #888;">Ce lien est valable 7 jours.</span>
      </p>
    </div>`
    : "";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>${greeting}</p>
      <p>Veuillez trouver ci-joint votre bon de commande pour le véhicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.
      </p>
      ${signCta}
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  // ---------------------------------------------------------------------------
  // 3) Envoi de l'email.
  // ---------------------------------------------------------------------------
  try {
    const { error } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: "bon-de-commande.pdf",
          content: pdfBase64,
        },
      ],
    });

    if (error) {
      return res.status(500).json({ error: error.message || "Échec d'envoi email" });
    }

    return res.status(200).json({
      ok: true,
      signatureRequest: signatureToken
        ? {
            token: signatureToken,
            signUrl,
            expiresAt: expiresAtIso,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec d'envoi email";
    return res.status(500).json({ error: message });
  }
}

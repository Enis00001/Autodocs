import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { buildHtml, renderPdfFromHtml } from "./_lib/bon-template";
import { getSupabaseAdmin } from "./_lib/supabase-admin";

type CompleteSignatureBody = {
  token?: string;
  signatureBase64?: string;
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST /api/complete-signature
 *
 * Endpoint PUBLIC (sans authentification). Le visiteur de /signer/:token
 * envoie ici sa signature manuscrite. On :
 *   1. Valide le token (existe, non expiré, non déjà signé).
 *   2. Re-rend le PDF avec les deux signatures (vendeur + client) via le
 *      template HTML — placeholders {{signature_vendeur}} et
 *      {{signature_client}} remplacés par des balises <img>.
 *   3. Persiste la signature client + signed_at + le PDF final dans la
 *      ligne `signature_requests`.
 *   4. Met à jour le brouillon associé : `client_signed_at` dans
 *      `vehicle_field_values` (pour permettre l'affichage du badge
 *      « Signé ✅ » côté tableau de bord).
 *   5. Envoie 2 emails de confirmation (client + vendeur) avec le PDF
 *      final en pièce jointe.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body: CompleteSignatureBody = {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as CompleteSignatureBody;
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as CompleteSignatureBody;
  }

  const token = String(body.token ?? "").trim();
  const signatureBase64 = String(body.signatureBase64 ?? "").trim();

  if (!token) return res.status(400).json({ error: "token requis" });
  if (!signatureBase64) {
    return res.status(400).json({ error: "signatureBase64 requis" });
  }

  // ---------------------------------------------------------------------------
  // 1) Récupération de la signature_request.
  // ---------------------------------------------------------------------------
  const admin = await getSupabaseAdmin();
  const { data: request, error: readError } = await admin
    .from("signature_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (readError) {
    console.error("[complete-signature] read error:", readError);
    return res.status(500).json({ error: "Erreur de lecture" });
  }
  if (!request) {
    return res.status(404).json({ error: "Demande de signature introuvable" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Déjà signé" });
  }
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Lien de signature expiré" });
  }

  // ---------------------------------------------------------------------------
  // 2) Re-rendu du PDF avec les deux signatures.
  // ---------------------------------------------------------------------------
  let signedPdfBase64: string;
  try {
    const formData =
      request.form_data && typeof request.form_data === "object"
        ? (request.form_data as Record<string, string>)
        : {};
    const html = buildHtml(formData, {
      signatureVendeurBase64: request.signature_vendeur ?? undefined,
      signatureClientBase64: signatureBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    signedPdfBase64 = pdfBuffer.toString("base64");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur lors de la génération du PDF signé";
    console.error("[complete-signature] render error:", err);
    return res.status(500).json({ error: message });
  }

  // ---------------------------------------------------------------------------
  // 3) Mise à jour de la signature_request.
  // ---------------------------------------------------------------------------
  const signedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("signature_requests")
    .update({
      signature_client: signatureBase64,
      signed_at: signedAt,
      pdf_base64: signedPdfBase64,
    })
    .eq("token", token);

  if (updateError) {
    console.error("[complete-signature] update error:", updateError);
    return res.status(500).json({ error: "Erreur d'enregistrement" });
  }

  // ---------------------------------------------------------------------------
  // 4) Marquage du brouillon comme « signé client ».
  // ---------------------------------------------------------------------------
  if (request.brouillon_id) {
    try {
      const { data: existing } = await admin
        .from("brouillons")
        .select("vehicle_field_values")
        .eq("id", request.brouillon_id)
        .maybeSingle();

      const currentKv =
        existing?.vehicle_field_values && typeof existing.vehicle_field_values === "object"
          ? (existing.vehicle_field_values as Record<string, unknown>)
          : {};

      await admin
        .from("brouillons")
        .update({
          vehicle_field_values: {
            ...currentKv,
            client_signed_at: signedAt,
          },
          updated_at: signedAt,
        })
        .eq("id", request.brouillon_id);
    } catch (err) {
      console.warn("[complete-signature] brouillon update failed:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // 5) Envoi des deux emails de confirmation.
  // ---------------------------------------------------------------------------
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[complete-signature] RESEND_API_KEY manquante — emails non envoyés");
    return res.status(200).json({
      ok: true,
      signedAt,
      pdfBase64: signedPdfBase64,
      emails: { client: false, vendeur: false },
    });
  }

  const resend = new Resend(apiKey);
  const from = process.env.RESEND_FROM_EMAIL || "AutoDocs <noreply@autodocs.services>";

  const clientEmail = String(request.client_email ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const vendeurEmail = String(request.vendeur_email ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";
  const fullClientName = `${clientPrenom} ${clientNom}`.trim() || clientEmail;

  const subject = `Bon de commande signé — ${vehiculeModele}`;
  const attachments = [
    {
      filename: "bon-de-commande-signe.pdf",
      content: signedPdfBase64,
    },
  ];

  const clientHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Merci pour votre signature. Vous trouverez en pièce jointe votre
        <strong>bon de commande signé</strong> pour le véhicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Conservez ce document : il fait foi entre vous et la concession.</p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  const vendeurHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour,</p>
      <p>Le client <strong>${escapeHtml(fullClientName)}</strong> a signé
        électroniquement le bon de commande pour le véhicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Le PDF final, comportant les deux signatures, est joint à cet email.</p>
      <p>— L'équipe AutoDocs</p>
    </div>
  `;

  const emailResults = { client: false, vendeur: false };

  try {
    const { error: clientErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html: clientHtml,
      attachments,
    });
    if (!clientErr) emailResults.client = true;
    else console.error("[complete-signature] email client error:", clientErr);
  } catch (err) {
    console.error("[complete-signature] email client exception:", err);
  }

  if (vendeurEmail) {
    try {
      const { error: vendeurErr } = await resend.emails.send({
        from,
        to: vendeurEmail,
        subject: `Bon signé par ${fullClientName} — ${vehiculeModele}`,
        html: vendeurHtml,
        attachments,
      });
      if (!vendeurErr) emailResults.vendeur = true;
      else console.error("[complete-signature] email vendeur error:", vendeurErr);
    } catch (err) {
      console.error("[complete-signature] email vendeur exception:", err);
    }
  }

  return res.status(200).json({
    ok: true,
    signedAt,
    pdfBase64: signedPdfBase64,
    emails: emailResults,
  });
}

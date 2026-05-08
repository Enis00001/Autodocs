import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import { buildHtml, renderPdfFromHtml } from "./_lib/bon-template";
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
  brouillonId?: string;
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
};

type EmbedSignatureBody = {
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
  pdfBase64?: string;
  signatureBase64?: string;
};

type CompleteSignatureBody = {
  token?: string;
  signatureBase64?: string;
};

type ResendBody = {
  brouillonId?: string;
  token?: string;
};

function parseRequestBody(req: VercelRequest): Record<string, unknown> | null {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }
  return {};
}

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
  return crypto.randomUUID();
}

async function handleSendEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const body = data as SendPdfEmailBody;
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
      console.error("[actions/send-email] insert signature_requests:", error);
      signatureToken = null;
      expiresAtIso = null;
    }
  } catch (err) {
    console.error("[actions/send-email] supabase admin error:", err);
    signatureToken = null;
    expiresAtIso = null;
  }

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
      return res.status(500).json({ error: error.message || "Echec d'envoi email" });
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
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }
}

async function handleEmbedSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as EmbedSignatureBody;

  if (body.pdfBase64 && !body.formData) {
    return res.status(400).json({
      error:
        "Contrat obsolète : envoyez `formData` + `signatureVendeurBase64` pour permettre l'incrustation HTML.",
    });
  }

  const formData = body.formData;
  const signatureVendeurBase64 =
    body.signatureVendeurBase64?.trim() || body.signatureBase64?.trim() || "";
  const signatureClientBase64 = body.signatureClientBase64?.trim() || "";

  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }
  if (!signatureVendeurBase64 && !signatureClientBase64) {
    return res
      .status(400)
      .json({ error: "Au moins une signature (vendeur ou client) est requise." });
  }

  try {
    const html = buildHtml(formData, {
      signatureVendeurBase64,
      signatureClientBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Echec de l'incrustation de la signature dans le PDF";
    console.error("[actions/embed-signature] error:", err);
    return res.status(500).json({ error: message });
  }
}

async function handleCompleteSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as CompleteSignatureBody;
  const token = String(body.token ?? "").trim();
  const signatureBase64 = String(body.signatureBase64 ?? "").trim();

  if (!token) return res.status(400).json({ error: "token requis" });
  if (!signatureBase64) {
    return res.status(400).json({ error: "signatureBase64 requis" });
  }

  const admin = await getSupabaseAdmin();
  const { data: request, error: readError } = await admin
    .from("signature_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (readError) {
    console.error("[actions/complete-signature] read error:", readError);
    return res.status(500).json({ error: "Erreur de lecture" });
  }
  if (!request) {
    return res.status(404).json({ error: "Demande de signature introuvable" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Lien de signature expire" });
  }

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
      err instanceof Error ? err.message : "Erreur lors de la generation du PDF signe";
    console.error("[actions/complete-signature] render error:", err);
    return res.status(500).json({ error: message });
  }

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
    console.error("[actions/complete-signature] update error:", updateError);
    return res.status(500).json({ error: "Erreur d'enregistrement" });
  }

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
      console.warn("[actions/complete-signature] brouillon update failed:", err);
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[actions/complete-signature] RESEND_API_KEY manquante — emails non envoyés");
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

  const subject = `Bon de commande signe — ${vehiculeModele}`;
  const attachments = [
    {
      filename: "bon-de-commande-signe.pdf",
      content: signedPdfBase64,
    },
  ];

  const clientHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Merci pour votre signature. Vous trouverez en piece jointe votre
        <strong>bon de commande signe</strong> pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Conservez ce document : il fait foi entre vous et la concession.</p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  const vendeurHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour,</p>
      <p>Le client <strong>${escapeHtml(fullClientName)}</strong> a signe
        electroniquement le bon de commande pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Le PDF final, comportant les deux signatures, est joint a cet email.</p>
      <p>— L'equipe AutoDocs</p>
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
    else console.error("[actions/complete-signature] email client error:", clientErr);
  } catch (err) {
    console.error("[actions/complete-signature] email client exception:", err);
  }

  if (vendeurEmail) {
    try {
      const { error: vendeurErr } = await resend.emails.send({
        from,
        to: vendeurEmail,
        subject: `Bon signe par ${fullClientName} — ${vehiculeModele}`,
        html: vendeurHtml,
        attachments,
      });
      if (!vendeurErr) emailResults.vendeur = true;
      else console.error("[actions/complete-signature] email vendeur error:", vendeurErr);
    } catch (err) {
      console.error("[actions/complete-signature] email vendeur exception:", err);
    }
  }

  return res.status(200).json({
    ok: true,
    signedAt,
    pdfBase64: signedPdfBase64,
    emails: emailResults,
  });
}

async function handleResendSignatureEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorise" });
  }

  const body = data as ResendBody;
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
    console.error("[actions/resend-signature-email] read error:", error);
    return res.status(500).json({ error: "Erreur de lecture" });
  }

  const request = rows?.[0];
  if (!request) {
    return res.status(404).json({ error: "Aucune demande de signature trouvee" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }

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
      console.error("[actions/resend-signature-email] insert error:", insertError);
      return res.status(500).json({ error: "Impossible de regenerer le lien" });
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
         pour le vehicule <strong>${escapeHtml(vehiculeModele)}</strong> :</p>
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
      return res.status(500).json({ error: emailErr.message || "Echec d'envoi email" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }

  return res.status(200).json({
    ok: true,
    token,
    signUrl,
    expiresAt,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = parseRequestBody(req);
  if (parsed === null) {
    return res.status(400).json({ error: "JSON invalide" });
  }

  const { action, ...data } = parsed;
  const actionName = String(action ?? "").trim();

  switch (actionName) {
    case "send-email":
      return handleSendEmail(req, data, res);
    case "embed-signature":
      return handleEmbedSignature(data, res);
    case "complete-signature":
      return handleCompleteSignature(data, res);
    case "resend-signature-email":
      return handleResendSignatureEmail(req, data, res);
    default:
      return res.status(400).json({ error: "Action inconnue" });
  }
}

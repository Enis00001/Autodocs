import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildHtml, renderPdfFromHtml } from "./_lib/bon-template";

type EmbedSignatureBody = {
  /**
   * Données du formulaire (mêmes clés que celles envoyées à /api/generate-pdf).
   * Permettent de re-rendre le HTML avec la signature insérée.
   */
  formData?: Record<string, string>;
  /**
   * Signature vendeur (base64 PNG, data URL acceptée). Insérée dans la zone
   * « Cachet & signature » via le placeholder {{signature_vendeur}} du
   * template HTML.
   */
  signatureVendeurBase64?: string;
  /**
   * Signature client (optionnel — utilisé par /api/complete-signature pour
   * produire le PDF final avec les deux signatures). Insérée dans la zone
   * « L'acheteur ».
   */
  signatureClientBase64?: string;
  /**
   * @deprecated — ancien contrat (PDF déjà généré + signature en base64).
   * Conservé pour compat ; déclenche désormais une erreur explicite invitant
   * à passer `formData`.
   */
  pdfBase64?: string;
  signatureBase64?: string;
};

/**
 * Endpoint POST /api/embed-signature
 *
 * Reçoit `{ formData, signatureVendeurBase64 [, signatureClientBase64] }`
 * et reconstruit le PDF en intégrant les images de signature directement
 * dans les zones HTML du template (`{{signature_vendeur}}` /
 * `{{signature_client}}`), évitant ainsi la pose à coordonnées fixes.
 *
 * Renvoie `{ pdfBase64 }`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body: EmbedSignatureBody = {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as EmbedSignatureBody;
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as EmbedSignatureBody;
  }

  // Compat : on rejette explicitement l'ancien contrat (pdfBase64 +
  // signatureBase64). Les clients à jour envoient désormais formData +
  // signatureVendeurBase64.
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
      err instanceof Error
        ? err.message
        : "Echec de l'incrustation de la signature dans le PDF";
    console.error("[embed-signature] error:", err);
    return res.status(500).json({ error: message });
  }
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type EmbedSignatureBody = {
  pdfBase64?: string;
  signatureBase64?: string;
};

/**
 * Coordonnées de la signature dans le PDF généré (origine en bas à gauche,
 * conforme à pdf-lib).
 *
 * Le template HTML (api/generate-pdf.ts) place deux blocs de signature en bas
 * de page (acheteur à gauche, vendeur à droite). On dépose ici la signature
 * du client dans la zone « signature client ». Les valeurs ont été calibrées
 * sur un A4 (595×842 pt) ; ajustez si vous personnalisez le template.
 */
const SIGNATURE_BOX = {
  x: 350,
  y: 50,
  width: 150,
  height: 60,
};

function decodeBase64Png(input: string): Buffer {
  const cleaned = input.replace(/^data:image\/png;base64,/, "").trim();
  return Buffer.from(cleaned, "base64");
}

function decodeBase64Pdf(input: string): Buffer {
  const cleaned = input.replace(/^data:application\/pdf;base64,/, "").trim();
  return Buffer.from(cleaned, "base64");
}

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

  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const signatureBase64 = String(body.signatureBase64 ?? "").trim();

  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 requis" });
  if (!signatureBase64) {
    return res.status(400).json({ error: "signatureBase64 requis" });
  }

  try {
    const pdfBytes = decodeBase64Pdf(pdfBase64);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
      return res.status(400).json({ error: "PDF sans page" });
    }
    const lastPage = pages[pages.length - 1];

    const signatureBytes = decodeBase64Png(signatureBase64);
    const signatureImage = await pdfDoc.embedPng(signatureBytes);

    // Conserve le ratio natif de la signature pour éviter une déformation.
    const scaled = signatureImage.scaleToFit(
      SIGNATURE_BOX.width,
      SIGNATURE_BOX.height,
    );

    lastPage.drawImage(signatureImage, {
      x: SIGNATURE_BOX.x,
      y: SIGNATURE_BOX.y,
      width: scaled.width,
      height: scaled.height,
    });

    const date = new Date().toLocaleDateString("fr-FR");
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    lastPage.drawText(`Signe le ${date}`, {
      x: SIGNATURE_BOX.x,
      y: SIGNATURE_BOX.y - 10,
      size: 8,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });

    const signedPdfBytes = await pdfDoc.save();
    const signedBase64 = Buffer.from(signedPdfBytes).toString("base64");

    return res.status(200).json({ pdfBase64: signedBase64 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Echec de l'integration de la signature";
    console.error("[embed-signature] error:", err);
    return res.status(500).json({ error: message });
  }
}

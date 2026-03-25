import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

type DocumentKind =
  | "cni"
  | "permis"
  | "justificatif_domicile"
  | "fiche_paie"
  | "avis_imposition"
  | "rib";

const VALID_KINDS = new Set<string>([
  "cni",
  "permis",
  "justificatif_domicile",
  "fiche_paie",
  "avis_imposition",
  "rib",
]);

function getPrompt(kind: DocumentKind): string {
  const common = [
    "Tu es un moteur OCR/validation de documents administratifs français.",
    "Réponds STRICTEMENT en JSON valide (sans markdown).",
    "Format de sortie:",
    "{",
    '  "status": "valid|invalid|unreadable",',
    '  "extracted_data": { ... },',
    '  "validation": { "is_valid": true|false, "reason": "message court en français" }',
    "}",
  ].join("\\n");

  const perType: Record<DocumentKind, string> = {
    cni: [
      "Document type: CNI ou Passeport.",
      "Extraire: nom, prenom, date_naissance, adresse, numero_cni, date_expiration.",
      "Validation: date_expiration > aujourd'hui.",
      'Si invalide: reason explicite (ex: "CNI expirée le 12/03/2024").',
    ].join("\\n"),
    permis: [
      "Document type: Permis de conduire.",
      "Extraire: numero, categories, date_expiration.",
      "Validation: date_expiration > aujourd'hui.",
    ].join("\\n"),
    justificatif_domicile: [
      "Document type: Justificatif de domicile.",
      "Extraire: nom, prenom, adresse_complete, date_document.",
      "Validation: date_document <= 3 mois.",
    ].join("\\n"),
    fiche_paie: [
      "Document type: Fiche de paie.",
      "Extraire: nom, prenom, employeur, salaire_net, periode.",
      "Validation: periode <= 3 mois.",
    ].join("\\n"),
    avis_imposition: [
      "Document type: Avis d'imposition.",
      "Extraire: nom, prenom, revenu_fiscal, annee.",
      "Validation: annee >= année courante - 1.",
    ].join("\\n"),
    rib: [
      "Document type: RIB.",
      "Extraire: titulaire, iban, bic, banque.",
      "Validation: format IBAN correct.",
    ].join("\\n"),
  };

  return `${common}\\n\\n${perType[kind]}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY non configurée côté serveur",
    });
  }

  let body: unknown = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Corps JSON invalide" });
    }
  }

  const payload = body as { imageBase64?: string; kind?: string };
  const { imageBase64, kind } = payload ?? {};

  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "imageBase64 requis" });
  }
  if (!kind || typeof kind !== "string" || !VALID_KINDS.has(kind)) {
    return res.status(400).json({ error: "kind invalide ou manquant" });
  }

  const prompt = getPrompt(kind as DocumentKind);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageBase64 } },
          ],
        },
      ],
    });

    return res.status(200).json({
      choices: [
        {
          message: {
            content: completion.choices?.[0]?.message?.content ?? null,
            refusal: completion.choices?.[0]?.message?.refusal ?? null,
          },
        },
      ],
    });
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 502;
    return res.status(status >= 500 ? 502 : status).json({
      error: error?.message ?? "Erreur OpenAI",
      type: error?.type,
      code: error?.code,
    });
  }
}

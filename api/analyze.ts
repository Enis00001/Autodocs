import type { VercelRequest, VercelResponse } from "@vercel/node";

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
  ].join("\n");

  const perType: Record<DocumentKind, string> = {
    cni: [
      "Document type: Carte Nationale d'Identité française (CNI) recto/verso.",
      "Extraire avec précision les champs suivants (clés exactes): nom, prenom, date_naissance, adresse, numero_cni, date_expiration.",
      "nom: nom de famille (champ 'NOM', souvent en MAJUSCULES sur la carte).",
      "prenom: champ 'Prénom(s)' (prénom principal + éventuels autres prénoms).",
      "numero_cni: numéro de CNI à 12 chiffres (principalement visible au dos de la carte).",
      "date_naissance: au format JJ MM AAAA (garder les espaces).",
      "adresse: adresse complète lisible sur la carte.",
      "Important: si un champ n'est pas totalement lisible, renvoyer la valeur partielle visible plutôt que 'Inconnu'.",
      "Important: la carte d'identité française a le numéro à 12 chiffres au dos de la carte.",
      "Validation: date_expiration > aujourd'hui.",
      'Si invalide: reason explicite (ex: "CNI expirée le 12/03/2024").',
    ].join("\n"),
    permis: [
      "Document type: Permis de conduire.",
      "Extraire: numero, categories, date_expiration.",
      "Validation: date_expiration > aujourd'hui.",
    ].join("\n"),
    justificatif_domicile: [
      "Document type: Justificatif de domicile.",
      "Extraire: nom, prenom, adresse_complete, date_document.",
      "Validation: date_document <= 3 mois.",
    ].join("\n"),
    fiche_paie: [
      "Document type: Fiche de paie.",
      "Extraire: nom, prenom, employeur, salaire_net, periode.",
      "Validation: periode <= 3 mois.",
    ].join("\n"),
    avis_imposition: [
      "Document type: Avis d'imposition.",
      "Extraire: nom, prenom, revenu_fiscal, annee.",
      "Validation: annee >= année courante - 1.",
    ].join("\n"),
    rib: [
      "Document type: RIB.",
      "Extraire: titulaire, iban, bic, banque.",
      "Validation: format IBAN correct.",
    ].join("\n"),
  };

  return `${common}\n\n${perType[kind]}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY non configurée côté serveur" });
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
  const approxImageBytes = Math.floor((imageBase64.length * 3) / 4);
  console.error("[analyze] Avant appel OpenAI", {
    kind,
    imageBase64Length: imageBase64.length,
    approxImageBytes,
  });

  try {
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          temperature: 0,
          max_tokens: 1000,
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
        }),
      },
    );

    if (!openaiRes.ok) {
      const errBody = await openaiRes.text().catch(() => "");
      console.error("[analyze] OpenAI API error", {
        status: openaiRes.status,
        body: errBody.slice(0, 500),
      });
      return res.status(openaiRes.status >= 500 ? 502 : openaiRes.status).json({
        error: `OpenAI API error ${openaiRes.status}`,
        details: errBody.slice(0, 300),
      });
    }

    const json = (await openaiRes.json()) as {
      choices?: Array<{
        message?: { content?: string | null; refusal?: string | null };
      }>;
    };

    const message = json.choices?.[0]?.message;
    const refusal = message?.refusal ?? null;
    const rawContent = message?.content ?? null;

    if (refusal) {
      console.error("[analyze] refusal exact:", refusal);
      return res
        .status(200)
        .json({ choices: [{ message: { content: null, refusal } }] });
    }

    if (typeof rawContent !== "string" || !rawContent.trim()) {
      console.error("[analyze] contenu vide reçu:", rawContent);
      return res.status(502).json({ error: "Réponse vide du modèle" });
    }

    try {
      JSON.parse(rawContent);
    } catch {
      console.error(
        "[analyze] JSON invalide, contenu brut reçu:",
        rawContent,
      );
      return res.status(502).json({
        error: "Réponse JSON invalide du modèle",
        rawContent,
      });
    }

    return res.status(200).json({
      choices: [{ message: { content: rawContent, refusal: null } }],
    });
  } catch (error: any) {
    console.error("[analyze] fetch error", error);
    return res.status(502).json({
      error: error?.message ?? "Erreur appel OpenAI",
    });
  }
}

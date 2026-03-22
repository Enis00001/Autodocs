export type DocumentKind =
  | "cni"
  | "permis"
  | "justificatif_domicile"
  | "fiche_paie"
  | "avis_imposition"
  | "rib";

export type AnalyzeResult = {
  status: "valid" | "invalid" | "unreadable";
  extractedData: Record<string, string>;
  validation: {
    isValid: boolean;
    reason?: string;
  };
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pdfFirstPageToDataUrl(file: File): Promise<string> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf");
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Impossible de créer le contexte canvas pour le PDF");
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}

async function toVisionImageDataUrl(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfFirstPageToDataUrl(file);
  }
  return fileToDataUrl(file);
}

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
      "Document type: CNI ou Passeport.",
      "Extraire: nom, prenom, date_naissance, adresse, numero_cni, date_expiration.",
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

function normalizeResult(parsed: any): AnalyzeResult {
  const status =
    parsed?.status === "valid" || parsed?.status === "invalid" || parsed?.status === "unreadable"
      ? parsed.status
      : "unreadable";
  const extractedData =
    parsed?.extracted_data && typeof parsed.extracted_data === "object"
      ? parsed.extracted_data
      : {};
  const validation = {
    isValid: Boolean(parsed?.validation?.is_valid),
    reason:
      typeof parsed?.validation?.reason === "string"
        ? parsed.validation.reason
        : undefined,
  };
  return { status, extractedData, validation };
}

export async function analyzeDocument(file: File, kind: DocumentKind): Promise<AnalyzeResult> {
  console.log("analyzeDocument appelé:", file.name, file.type, kind);
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  console.log("Clé API présente:", !!apiKey);
  if (!apiKey) {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Clé API OpenAI manquante" },
    };
  }

  // Accepter images + PDF (PDF converti en image via canvas). Rejeter le reste.
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isImage && !isPdf) {
    return {
      status: "unreadable",
      extractedData: {},
      validation: {
        isValid: false,
        reason: "Format non pris en charge (utilisez image ou PDF).",
      },
    };
  }

  let dataUrl = "";
  try {
    dataUrl = await toVisionImageDataUrl(file);
  } catch (err) {
    console.error("Conversion PDF/image échouée:", err);
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Impossible de lire le document" },
    };
  }
  const prompt = getPrompt(kind);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  console.log("Réponse OpenAI status:", response.status);

  if (!response.ok) {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: `Erreur API OpenAI (${response.status})` },
    };
  }

  const json = await response.json();
  console.log("JSON complet reçu:", JSON.stringify(json));
  const content = json?.choices?.[0]?.message?.content;
  const refusal = json?.choices?.[0]?.message?.refusal;
  console.log("Contenu réponse:", content);
  if (refusal) {
    return {
      status: "invalid",
      extractedData: {},
      validation: {
        isValid: false,
        reason: "Document non analysable. Utilisez une photo nette du document original.",
      },
    };
  }
  if (!content) {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Réponse vide du modèle" },
    };
  }

  try {
    const parsed = JSON.parse(content);
    return normalizeResult(parsed);
  } catch {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Réponse JSON invalide" },
    };
  }
}


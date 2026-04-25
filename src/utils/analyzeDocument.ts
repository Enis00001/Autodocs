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
    reader.onload = () => {
      const result = String(reader.result ?? "");
      console.log(
        "[analyzeDocument] FileReader loaded, dataUrl length:",
        result.length,
        "préfixe:",
        result.slice(0, 64),
      );
      resolve(result);
    };
    reader.onerror = (e) => {
      console.error("[analyzeDocument] FileReader error:", e, reader.error);
      reject(reader.error ?? new Error("FileReader error"));
    };
    reader.readAsDataURL(file);
  });
}

async function pdfFirstPageToDataUrl(file: File): Promise<string> {
  type PdfPage = {
    getViewport: (options: { scale: number }) => { width: number; height: number };
    render: (options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }) => { promise: Promise<void> };
  };
  type PdfJsModule = {
    getDocument: (options: { data: ArrayBuffer; disableWorker: boolean }) => {
      promise: Promise<{ getPage: (pageNumber: number) => Promise<PdfPage> }>;
    };
  };

  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf")) as PdfJsModule;
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
    throw new Error("Impossible de creer le contexte canvas pour le PDF");
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeCniResult(parsed: unknown): AnalyzeResult {
  const data = asRecord(parsed) ?? {};
  const dateNaissance =
    typeof data.date_naissance === "string"
      ? data.date_naissance
      : typeof data.dateNaissance === "string"
        ? data.dateNaissance
        : typeof data.date_de_naissance === "string"
          ? data.date_de_naissance
          : "";
  const extractedData = {
    nom: typeof data.nom === "string" ? data.nom : "",
    prenom: typeof data.prenom === "string" ? data.prenom : "",
    date_naissance: dateNaissance,
  };
  const hasExtractedValue = Object.values(extractedData).some((value) => value.trim());

  return {
    status: hasExtractedValue ? "valid" : "unreadable",
    extractedData,
    validation: {
      isValid: hasExtractedValue,
      reason: hasExtractedValue ? undefined : "Aucune information CNI lisible",
    },
  };
}

function normalizeResult(parsed: unknown, kind: DocumentKind): AnalyzeResult {
  const data = asRecord(parsed) ?? {};
  if (kind === "cni" && !data.extracted_data) {
    return normalizeCniResult(parsed);
  }

  const status =
    data.status === "valid" || data.status === "invalid" || data.status === "unreadable"
      ? data.status
      : "unreadable";
  const rawExtractedData = data.extracted_data ? asRecord(data.extracted_data) : null;
  const extractedData = kind === "cni" ? normalizeCniResult(rawExtractedData).extractedData : rawExtractedData;
  const validationData = data.validation ? asRecord(data.validation) : null;
  const validation = {
    isValid: Boolean(validationData?.is_valid),
    reason:
      typeof validationData?.reason === "string"
        ? validationData.reason
        : undefined,
  };
  return { status, extractedData: extractedData ? toStringRecord(extractedData) : {}, validation };
}

export async function analyzeDocument(file: File, kind: DocumentKind): Promise<AnalyzeResult> {
  console.log("[analyzeDocument] appelé avec:", {
    name: file?.name,
    type: file?.type,
    size: file?.size,
    kind,
  });

  if (!file) {
    console.error("[analyzeDocument] Erreur: fichier manquant (null/undefined)");
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Aucun fichier fourni à analyser" },
    };
  }
  if (!file.size || file.size === 0) {
    console.error("[analyzeDocument] Erreur: fichier vide (size=0)");
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Fichier vide — reprenez la photo" },
    };
  }

  const lowerName = (file.name || "").toLowerCase();
  const hasImageExt = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(lowerName);
  const hasPdfExt = lowerName.endsWith(".pdf");
  // Mobile Safari / Android Chrome peuvent renvoyer un `file.type` vide pour
  // les captures caméra. On retombe alors sur l'extension, voire on force
  // "image" si rien n'est détectable (la conversion essaiera d'encoder comme
  // image standard, c'est la supposition la plus probable pour un scan CNI).
  const isImage = (file.type || "").startsWith("image/") || hasImageExt;
  const isPdf = file.type === "application/pdf" || hasPdfExt;
  if (!isImage && !isPdf && file.type) {
    console.error("[analyzeDocument] Format non supporté:", file.type, file.name);
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
    console.error("[analyzeDocument] Conversion PDF/image échouée:", err);
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Impossible de lire le document" },
    };
  }

  console.log("[analyzeDocument] Image size (base64 length):", dataUrl.length);

  if (!dataUrl || !dataUrl.startsWith("data:")) {
    console.error(
      "[analyzeDocument] dataUrl invalide avant envoi (vide ou mal formée):",
      dataUrl.slice(0, 32),
    );
    return {
      status: "unreadable",
      extractedData: {},
      validation: {
        isValid: false,
        reason: "Image illisible — reprenez la photo.",
      },
    };
  }

  console.log("[analyzeDocument] Appel API analyze...");
  let response: Response;
  try {
    const { apiFetch } = await import("@/lib/apiClient");
    response = await apiFetch("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        imageBase64: dataUrl,
        kind,
      }),
    });
  } catch (err) {
    console.error("[analyzeDocument] Erreur analyze (réseau /api/analyze):", err);
    return {
      status: "unreadable",
      extractedData: {},
      validation: {
        isValid: false,
        reason: "Impossible de contacter le serveur d'analyse (/api/analyze).",
      },
    };
  }

  console.log("[analyzeDocument] Réponse proxy /api/analyze status:", response.status);

  if (!response.ok) {
    let reason = `Erreur API analyse (${response.status})`;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (typeof errBody?.error === "string" && errBody.error.trim()) {
        reason = errBody.error;
      }
    } catch {
      // ignore parsing error
    }
    console.error("[analyzeDocument] Erreur analyze (réponse non-OK):", reason);
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason },
    };
  }

  const json = await response.json();
  console.log("[analyzeDocument] JSON complet reçu:", JSON.stringify(json).slice(0, 600));
  const content = json?.choices?.[0]?.message?.content;
  const refusal = json?.choices?.[0]?.message?.refusal;

  if (refusal) {
    return {
      status: "invalid",
      extractedData: {},
      validation: {
        isValid: false,
        reason: typeof refusal === "string" && refusal.trim() ? refusal : "Document refusé par le modèle",
      },
    };
  }
  if (!content) {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Reponse vide du modele" },
    };
  }

  try {
    const parsed = JSON.parse(content);
    return normalizeResult(parsed, kind);
  } catch {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Reponse JSON invalide du modele" },
    };
  }
}


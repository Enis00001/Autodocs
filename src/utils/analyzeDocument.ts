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
  console.log("analyzeDocument appele:", file.name, file.type, kind);

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
    console.error("Conversion PDF/image echouee:", err);
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Impossible de lire le document" },
    };
  }

  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        imageBase64: dataUrl,
        kind,
      }),
    });
  } catch (err) {
    console.error("Erreur reseau vers /api/analyze:", err);
    return {
      status: "unreadable",
      extractedData: {},
      validation: {
        isValid: false,
        reason: "Impossible de contacter le serveur d'analyse (/api/analyze).",
      },
    };
  }

  console.log("Reponse proxy /api/analyze status:", response.status);

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
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason },
    };
  }

  const json = await response.json();
  console.log("JSON complet recu:", JSON.stringify(json));
  const content = json?.choices?.[0]?.message?.content;
  const refusal = json?.choices?.[0]?.message?.refusal;

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
      validation: { isValid: false, reason: "Reponse vide du modele" },
    };
  }

  try {
    const parsed = JSON.parse(content);
    return normalizeResult(parsed);
  } catch {
    return {
      status: "unreadable",
      extractedData: {},
      validation: { isValid: false, reason: "Reponse JSON invalide" },
    };
  }
}

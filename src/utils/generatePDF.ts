import { loadTemplates, type Template } from "@/utils/templates";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const COORDS_CACHE_KEY = "autodocs_pdf_coords_cache_v1";

function getLocalCoordsCache(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COORDS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setLocalCoordsCache(cache: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COORDS_CACHE_KEY, JSON.stringify(cache));
}

function guessSelectedTemplate(templates: Template[]): Template | null {
  const withPdf = templates.filter((t) => t.contentBase64 && t.mimeType?.includes("pdf"));
  if (withPdf.length === 0) return null;
  return withPdf[0];
}

function extractFormDataFromDom(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const out: Record<string, string> = {};

  const labelMap: Record<string, string> = {
    nom: "nom_client",
    prénom: "prenom_client",
    "date de naissance": "date_naissance_client",
    "n° cni": "numero_cni",
    adresse: "adresse_client",
    email: "email_client",
    téléphone: "telephone_client",
    titulaire: "titulaire_rib",
    iban: "iban",
    bic: "bic",
    banque: "banque_rib",
  };

  const labels = Array.from(document.querySelectorAll("label"));
  labels.forEach((labelEl) => {
    const labelTxt = labelEl.textContent?.trim().toLowerCase() ?? "";
    const key = Object.entries(labelMap).find(([k]) => labelTxt.includes(k))?.[1];
    if (!key) return;
    const wrapper = labelEl.parentElement;
    const input = wrapper?.querySelector("input,textarea,select") as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    if (!input) return;
    out[key] = String((input as any).value ?? "");
  });

  return out;
}

function downloadBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function firstPdfPageToPngDataUrl(templateBase64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(templateBase64), (c) => c.charCodeAt(0));
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2 });

  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    context = canvas.getContext("2d");
  } else {
    const htmlCanvas = document.createElement("canvas");
    htmlCanvas.width = Math.floor(viewport.width);
    htmlCanvas.height = Math.floor(viewport.height);
    canvas = htmlCanvas;
    context = htmlCanvas.getContext("2d");
  }

  if (!context) {
    throw new Error("Impossible de créer le canvas pour convertir le PDF");
  }

  await page.render({ canvasContext: context as any, viewport }).promise;

  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const arr = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    arr.forEach((b) => (binary += String.fromCharCode(b)));
    return `data:image/png;base64,${btoa(binary)}`;
  }

  return (canvas as HTMLCanvasElement).toDataURL("image/png");
}

export async function generatePDF() {
  const templates = await loadTemplates();
  const selectedTemplate = guessSelectedTemplate(templates);
  if (!selectedTemplate?.contentBase64) {
    throw new Error("Aucun template PDF sélectionné/importé.");
  }

  const formData = extractFormDataFromDom();
  const templateImageBase64 = await firstPdfPageToPngDataUrl(selectedTemplate.contentBase64);
  const cache = getLocalCoordsCache();
  const templateCacheKey = selectedTemplate.id;

  const response = await fetch("/api/fill-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      templateBase64: selectedTemplate.contentBase64,
      formData,
      templateImageBase64,
    }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody?.error || `Erreur génération PDF (${response.status})`);
  }

  const json = (await response.json()) as { pdfBase64: string; coordinates?: unknown };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur PDF.");
  }

  if (json.coordinates) {
    cache[templateCacheKey] = json.coordinates;
    setLocalCoordsCache(cache);
  }

  const fileName = `bon-de-commande-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBase64Pdf(json.pdfBase64, fileName);
}


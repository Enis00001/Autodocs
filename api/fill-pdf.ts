import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { fromBuffer } from "pdf2pic";

type FieldCoord = { page: number; x: number; y: number };
type CoordMap = Record<string, FieldCoord>;

const coordCache = new Map<string, CoordMap>();

function getPrompt(): string {
  return [
    "Tu analyses un template PDF de bon de commande automobile.",
    "Retourne STRICTEMENT un JSON valide (sans markdown).",
    "Le JSON doit être un dictionnaire clé -> coordonnées :",
    "{",
    '  "nom_client": { "page": 1, "x": 150, "y": 320 },',
    '  "prenom_client": { "page": 1, "x": 280, "y": 320 },',
    '  "prix_ttc": { "page": 1, "x": 150, "y": 450 }',
    "}",
    "Contraintes:",
    "- page commence à 1",
    "- x et y sont des nombres",
    "- détecte un maximum de champs utiles pour un bon de commande auto",
  ].join("\n");
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toCacheKey(templateBase64: string): string {
  return `tpl:${templateBase64.length}:${templateBase64.slice(0, 64)}`;
}

function sanitizeCoordinates(raw: unknown): CoordMap {
  if (!raw || typeof raw !== "object") return {};
  const out: CoordMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const page = Number((val as any).page);
    const x = Number((val as any).x);
    const y = Number((val as any).y);
    if (!Number.isFinite(page) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    out[key] = { page, x, y };
  }
  return out;
}

function fieldValue(formData: Record<string, unknown>, key: string): string {
  const v = formData[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

async function pdfFirstPageToPngDataUrl(templateBase64: string): Promise<string> {
  const pdfBuffer = Buffer.from(templateBase64, "base64");
  const convert = fromBuffer(pdfBuffer, {
    density: 144,
    format: "png",
    width: 1400,
    height: 2000,
    savePath: "/tmp",
    saveFilename: `tpl-${Date.now()}`,
  });

  const result = (await convert(1, { responseType: "base64" })) as {
    base64?: string;
  };

  if (!result?.base64) {
    throw new Error("Conversion PDF->PNG échouée (base64 vide)");
  }

  return `data:image/png;base64,${result.base64}`;
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

  const body = typeof req.body === "string" ? safeJsonParse<any>(req.body) : req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }

  const { templateBase64, formData } = body as {
    templateBase64?: string;
    formData?: Record<string, unknown>;
    cachedCoordinates?: Record<string, unknown>;
  };

  if (!templateBase64 || typeof templateBase64 !== "string") {
    return res.status(400).json({ error: "templateBase64 manquant" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData manquant" });
  }

  const cacheKey = toCacheKey(templateBase64);
  const clientCached = sanitizeCoordinates((body as any).cachedCoordinates);
  let coordinates = coordCache.get(cacheKey);
  if (!coordinates && Object.keys(clientCached).length > 0) {
    coordinates = clientCached;
    coordCache.set(cacheKey, coordinates);
  }

  if (!coordinates) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const firstPagePngDataUrl = await pdfFirstPageToPngDataUrl(templateBase64);

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: getPrompt() },
              { type: "image_url", image_url: { url: firstPagePngDataUrl } },
            ],
          },
        ],
      });

      const content = completion.choices?.[0]?.message?.content ?? "{}";
      const parsed = safeJsonParse<Record<string, unknown>>(content) ?? {};
      coordinates = sanitizeCoordinates(parsed);
      coordCache.set(cacheKey, coordinates);
    } catch (err: any) {
      console.error("[fill-pdf] GPT step failed", {
        message: err?.message,
        status: err?.status,
        type: err?.type,
        code: err?.code,
        body: err?.error ?? err,
      });
      return res.status(502).json({
        error: err?.message ?? "Erreur GPT lors de la détection des coordonnées",
        stage: "gpt_detection",
        details: {
          status: err?.status,
          type: err?.type,
          code: err?.code,
        },
      });
    }
  }

  try {
    const pdfBytes = Uint8Array.from(Buffer.from(templateBase64, "base64"));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const [key, coord] of Object.entries(coordinates)) {
      const pageIndex = Math.max(0, Math.floor(coord.page) - 1);
      const page = pdfDoc.getPages()[pageIndex];
      if (!page) continue;
      const value = fieldValue(formData, key);
      if (!value) continue;
      const yFromTop = coord.y;
      const yPdf = page.getHeight() - yFromTop;
      page.drawText(value, {
        x: coord.x,
        y: yPdf,
        size: 10,
        font,
        color: rgb(0, 0, 0),
        lineHeight: 10,
        maxWidth: 260,
      });
    }

    const filledBytes = await pdfDoc.save();
    const filledBase64 = Buffer.from(filledBytes).toString("base64");
    return res.status(200).json({ pdfBase64: filledBase64, coordinates });
  } catch (err: any) {
    console.error("[fill-pdf] pdf-lib step failed", {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: err?.message ?? "Erreur pdf-lib lors du remplissage du PDF",
      stage: "pdf_fill",
    });
  }
}


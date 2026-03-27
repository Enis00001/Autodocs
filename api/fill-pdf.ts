import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type FieldCoordPercent = { x: number; y: number; valeur?: string };
type CoordMap = Record<string, FieldCoordPercent>;

const coordCache = new Map<string, CoordMap>();

function getPrompt(formData: Record<string, unknown>): string {
  const formDataJson = JSON.stringify(formData, null, 2);
  return [
    "Tu analyses un bon de commande automobile vierge.",
    "Voici les données à injecter :",
    formDataJson,
    "Pour chaque donnée, identifie la zone correspondante sur le document et retourne les coordonnées x,y en pourcentage de la page (0-100) où écrire la valeur.",
    "Retourne UNIQUEMENT un JSON valide (sans markdown, sans texte supplémentaire) au format :",
    "{",
    '  "nom_client": { "x": 45, "y": 23, "valeur": "MARTIN" },',
    '  "prenom_client": { "x": 65, "y": 23, "valeur": "Jean" }',
    "}",
    "Contraintes importantes :",
    "- x et y sont des nombres entre 0 et 100",
    "- inclure uniquement les clés présentes dans les données",
    "- conserver la valeur exacte fournie dans les données",
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
    const x = Number((val as any).x);
    const y = Number((val as any).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const clampedX = Math.max(0, Math.min(100, x));
    const clampedY = Math.max(0, Math.min(100, y));
    const valeurRaw = (val as any).valeur;
    out[key] = {
      x: clampedX,
      y: clampedY,
      valeur: valeurRaw === null || valeurRaw === undefined ? undefined : String(valeurRaw),
    };
  }
  return out;
}

function fieldValue(formData: Record<string, unknown>, key: string): string {
  const v = formData[key];
  if (v === null || v === undefined) return "";
  return String(v);
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

  const { templateBase64, formData, templateImageBase64 } = body as {
    templateBase64?: string;
    formData?: Record<string, unknown>;
    templateImageBase64?: string;
    cachedCoordinates?: Record<string, unknown>;
  };

  if (!templateBase64 || typeof templateBase64 !== "string") {
    return res.status(400).json({ error: "templateBase64 manquant" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData manquant" });
  }
  if (!templateImageBase64 || typeof templateImageBase64 !== "string") {
    return res.status(400).json({ error: "templateImageBase64 manquant (conversion PDF->PNG côté client)" });
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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: getPrompt(formData) },
              { type: "image_url", image_url: { url: templateImageBase64 } },
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
    const firstPage = pdfDoc.getPages()[0];
    if (!firstPage) {
      return res.status(500).json({ error: "Le template PDF ne contient aucune page", stage: "pdf_fill" });
    }

    for (const [key, coord] of Object.entries(coordinates)) {
      const page = firstPage;
      const value = fieldValue(formData, key) || coord.valeur || "";
      if (!value) continue;
      const xPdf = (coord.x / 100) * page.getWidth();
      const yFromTop = (coord.y / 100) * page.getHeight();
      const yPdf = page.getHeight() - yFromTop;
      page.drawText(value, {
        x: xPdf,
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


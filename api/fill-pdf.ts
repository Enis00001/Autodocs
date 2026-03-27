import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { PDFDocument } from "pdf-lib";

type PdfFieldMapping = Record<string, string>;

function getMappingPrompt(fieldNames: string[], formData: Record<string, unknown>): string {
  const nonEmptyFormData = Object.fromEntries(
    Object.entries(formData).filter(([, value]) => String(value ?? "").trim() !== "")
  );
  return [
    "Tu es un expert en mapping de champs PDF AcroForm.",
    "Voici les champs du PDF (noms exacts):",
    JSON.stringify(fieldNames, null, 2),
    "",
    "Voici les donnees disponibles a injecter:",
    JSON.stringify(nonEmptyFormData, null, 2),
    "",
    "Associe intelligemment les donnees aux champs PDF correspondants.",
    "Regles:",
    "- utilise uniquement les noms de champs PDF de la liste",
    "- n'inclus que les valeurs non vides",
    "- retourne UNIQUEMENT un JSON objet { nomChampPDF: valeurAInjecter }",
    "- pas de markdown, pas d'explication",
  ].join("\n");
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function sanitizeMapping(raw: unknown, fieldNames: string[]): PdfFieldMapping {
  if (!raw || typeof raw !== "object") return {};
  const allowed = new Set(fieldNames);
  const out: PdfFieldMapping = {};
  for (const [fieldName, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.has(fieldName)) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    out[fieldName] = value;
  }
  return out;
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
  };

  if (!templateBase64 || typeof templateBase64 !== "string") {
    return res.status(400).json({ error: "templateBase64 manquant" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData manquant" });
  }

  try {
    const pdfBytes = Uint8Array.from(Buffer.from(templateBase64, "base64"));
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const fieldNames = fields.map((f) => f.getName());
    fields.forEach((f) => console.log("[fill-pdf] field:", f.getName()));

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: getMappingPrompt(fieldNames, formData) }],
        },
      ],
    });
    const content = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = safeJsonParse<Record<string, unknown>>(content) ?? {};
    const mapping = sanitizeMapping(parsed, fieldNames);

    for (const field of fields) {
      try {
        const fieldName = field.getName();
        const value = mapping[fieldName];
        if (!value) continue;

        const fieldType = field.constructor.name;
        if (fieldType === "PDFTextField") {
          const textField = form.getTextField(fieldName) as any;
          if (typeof textField.disableRichFormatting === "function") {
            textField.disableRichFormatting();
          }
          textField.setText(String(value));
        } else if (fieldType === "PDFCheckBox") {
          const normalized = String(value).trim().toLowerCase();
          if (normalized === "true" || normalized === "1" || normalized === "oui" || normalized === "yes") {
            form.getCheckBox(fieldName).check();
          }
        }
      } catch (err) {
        console.warn("Champ ignoré:", field.getName(), err);
        continue;
      }
    }

    form.flatten();

    const filledBytes = await pdfDoc.save();
    const filledBase64 = Buffer.from(filledBytes).toString("base64");
    return res.status(200).json({ pdfBase64: filledBase64, mapping });
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


import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body =
    typeof req.body === "string"
      ? safeJsonParse<Record<string, unknown>>(req.body)
      : req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }

  const { templateId, formData } = body as {
    templateId?: string;
    formData?: Record<string, unknown>;
  };

  if (!templateId || typeof templateId !== "string") {
    return res.status(400).json({ error: "templateId manquant" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData manquant" });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({
      error:
        "Supabase non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY requis)",
    });
  }

  const { data: tplRow, error: tplError } = await supabase
    .from("pdf_templates")
    .select("field_mapping, storage_path")
    .eq("id", templateId)
    .single();

  if (tplError || !tplRow) {
    return res.status(404).json({
      error: `Template introuvable (id=${templateId})`,
      details: tplError,
    });
  }

  const fieldMapping: Record<string, string> =
    tplRow.field_mapping && typeof tplRow.field_mapping === "object"
      ? (tplRow.field_mapping as Record<string, string>)
      : {};
  const storagePath: string = tplRow.storage_path ?? "";

  if (!storagePath) {
    return res
      .status(400)
      .json({ error: "storage_path vide pour ce template" });
  }

  if (Object.keys(fieldMapping).length === 0) {
    return res.status(400).json({
      error:
        "field_mapping vide pour ce template — relancez l'analyse du template",
    });
  }

  const bucket = process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
  const { data: fileData, error: dlError } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (dlError || !fileData) {
    return res.status(500).json({
      error: `Téléchargement du PDF impossible : ${dlError?.message ?? "fichier introuvable"}`,
    });
  }

  const pdfBytes = new Uint8Array(await fileData.arrayBuffer());

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    for (const field of fields) {
      try {
        const pdfFieldName = field.getName();
        const standardKey = fieldMapping[pdfFieldName];
        if (!standardKey) continue;

        const value = String(formData[standardKey] ?? "").trim();
        if (!value) continue;

        const fieldType = field.constructor.name;
        if (fieldType === "PDFTextField") {
          const textField = form.getTextField(pdfFieldName);
          if (typeof (textField as any).disableRichFormatting === "function") {
            (textField as any).disableRichFormatting();
          }
          textField.setText(value);
        } else if (fieldType === "PDFCheckBox") {
          const normalized = value.toLowerCase();
          if (["true", "1", "oui", "yes"].includes(normalized)) {
            form.getCheckBox(pdfFieldName).check();
          }
        }
      } catch (err) {
        console.warn("[fill-pdf] Champ ignoré:", field.getName(), err);
      }
    }

    form.flatten();

    const filledBytes = await pdfDoc.save();
    const filledBase64 = Buffer.from(filledBytes).toString("base64");
    return res
      .status(200)
      .json({ pdfBase64: filledBase64, mapping: fieldMapping });
  } catch (err: any) {
    console.error("[fill-pdf] Erreur lors du remplissage", {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: err?.message ?? "Erreur pdf-lib lors du remplissage du PDF",
      stage: "pdf_fill",
    });
  }
}

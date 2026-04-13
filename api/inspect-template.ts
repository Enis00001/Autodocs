import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

type InspectField = {
  name: string;
  type: string;
  value: string | boolean | null;
  rect: [number, number, number, number] | null;
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeFieldType(className: string): string {
  return className.replace(/^PDF/, "");
}

function extractFieldValue(field: any): string | boolean | null {
  try {
    const type = field?.constructor?.name ?? "";
    if (type === "PDFTextField") {
      const txt = field.getText?.();
      return typeof txt === "string" ? txt : null;
    }
    if (type === "PDFCheckBox") {
      return !!field.isChecked?.();
    }
    if (type === "PDFDropdown" || type === "PDFOptionList") {
      const selected = field.getSelected?.();
      if (Array.isArray(selected)) return selected.join(", ");
      return typeof selected === "string" ? selected : null;
    }
    if (type === "PDFRadioGroup") {
      const selected = field.getSelected?.();
      return typeof selected === "string" ? selected : null;
    }
    return null;
  } catch {
    return null;
  }
}

function extractRect(field: any): [number, number, number, number] | null {
  try {
    const widget = field?.acroField?.getWidgets?.()?.[0];
    const r = widget?.getRectangle?.();
    if (!r) return null;
    const x1 = Number(r.x ?? 0);
    const y1 = Number(r.y ?? 0);
    const x2 = x1 + Number(r.width ?? 0);
    const y2 = y1 + Number(r.height ?? 0);
    return [x1, y1, x2, y2];
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const templateId =
    typeof req.query.templateId === "string" ? req.query.templateId.trim() : "";
  if (!templateId) {
    return res.status(400).json({ error: "templateId manquant en query param" });
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
    .select("storage_path")
    .eq("id", templateId)
    .single();

  if (tplError || !tplRow) {
    return res.status(404).json({
      error: `Template introuvable (id=${templateId})`,
      details: tplError,
    });
  }

  const storagePath = String(tplRow.storage_path ?? "").trim();
  if (!storagePath) {
    return res.status(400).json({ error: "storage_path vide pour ce template" });
  }

  const bucket = process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
  const { data: fileData, error: dlError } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (dlError || !fileData) {
    return res.status(500).json({
      error: `Téléchargement du PDF impossible : ${
        dlError?.message ?? "fichier introuvable"
      }`,
    });
  }

  try {
    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const inspected: InspectField[] = fields.map((field: any) => ({
      name: field.getName(),
      type: normalizeFieldType(field.constructor.name),
      value: extractFieldValue(field),
      rect: extractRect(field),
    }));

    inspected.sort((a, b) => {
      const ay = a.rect ? a.rect[1] : -Infinity;
      const by = b.rect ? b.rect[1] : -Infinity;
      return by - ay;
    });

    return res.status(200).json({
      templateId,
      storagePath,
      fields: inspected,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message ?? "Erreur lors de l'inspection du template",
      stage: "inspect_template",
    });
  }
}


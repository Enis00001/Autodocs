import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

type InspectField = {
  name: string;
  type: string;
  rect: { x: number; y: number; width: number; height: number } | null;
};

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function extractRect(field: any): { x: number; y: number; width: number; height: number } | null {
  try {
    const widget = field?.acroField?.getWidgets?.()?.[0];
    const r = widget?.getRectangle?.();
    if (!r) return null;
    return {
      x: Number(r.x ?? 0),
      y: Number(r.y ?? 0),
      width: Number(r.width ?? 0),
      height: Number(r.height ?? 0),
    };
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

  try {
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

    const { data: fileData, error: dlError } = await supabase.storage
      .from("pdf-templates")
      .download(storagePath);

    if (dlError || !fileData) {
      return res.status(500).json({
        error: `Téléchargement du PDF impossible : ${
          dlError?.message ?? "fichier introuvable"
        }`,
      });
    }

    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const inspected: InspectField[] = fields.map((field: any) => ({
      name: field.getName(),
      type: field.constructor.name,
      rect: extractRect(field),
    }));

    inspected.sort((a, b) => {
      const ay = a.rect ? a.rect.y : -Infinity;
      const by = b.rect ? b.rect.y : -Infinity;
      return by - ay;
    });

    return res.status(200).json({
      templateId,
      fields: inspected,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message ?? "Erreur lors de l'inspection du template",
      stage: "inspect_template",
    });
  }
}


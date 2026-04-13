import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";

type InspectField = {
  index: number;
  name: string;
  type: string;
  page: number | null;
  rect: { x: number; y: number; width: number; height: number } | null;
};

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const templateId =
    typeof req.query.templateId === "string"
      ? req.query.templateId.trim()
      : "";
  if (!templateId) {
    return res
      .status(400)
      .json({ error: "templateId manquant en query param" });
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
      return res
        .status(400)
        .json({ error: "storage_path vide pour ce template" });
    }

    const bucket =
      process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
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

    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const pages = pdfDoc.getPages();

    const pageRefStrings: string[] = pages.map((p: any) => {
      try {
        return p.ref?.toString() ?? "";
      } catch {
        return "";
      }
    });

    function getPageNumber(widget: any): number | null {
      try {
        const pRef = widget?.dict?.get(PDFName.of("P"));
        if (pRef) {
          const refStr = pRef.toString();
          const idx = pageRefStrings.indexOf(refStr);
          if (idx >= 0) return idx + 1;
        }
      } catch {}
      return null;
    }

    function extractFieldInfo(field: any, index: number): InspectField {
      let rect: InspectField["rect"] = null;
      let page: number | null = null;

      try {
        const widgets = field.acroField?.getWidgets?.() ?? [];
        const widget = widgets[0];
        if (widget) {
          const r = widget.getRectangle?.();
          if (r) {
            rect = {
              x: Number(r.x ?? 0),
              y: Number(r.y ?? 0),
              width: Number(r.width ?? 0),
              height: Number(r.height ?? 0),
            };
          }
          page = getPageNumber(widget);
        }
      } catch {}

      return {
        index,
        name: field.getName(),
        type: field.constructor.name,
        page,
        rect,
      };
    }

    const inspected: InspectField[] = fields.map((field: any, i: number) =>
      extractFieldInfo(field, i),
    );

    inspected.sort((a, b) => {
      const pa = a.page ?? 0;
      const pb = b.page ?? 0;
      if (pa !== pb) return pa - pb;
      const ay = a.rect?.y ?? -Infinity;
      const by = b.rect?.y ?? -Infinity;
      return by - ay;
    });

    const pagesSummary = pages.map((p, i) => {
      const { width, height } = p.getSize();
      return { page: i + 1, width, height };
    });

    return res.status(200).json({
      templateId,
      storagePath,
      totalFields: inspected.length,
      pages: pagesSummary,
      fields: inspected,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message ?? "Erreur lors de l'inspection du template",
      stage: "inspect_template",
    });
  }
}

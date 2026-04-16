import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

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
  const debug = {
    templateId: typeof templateId === "string" ? templateId : null,
    formData: {} as Record<string, unknown>,
    field_mapping: {} as Record<string, string>,
    matches: [] as Array<{
      pdfFieldName: string;
      standardKey: string | null;
      value: string;
    }>,
  };

  if (!templateId || typeof templateId !== "string") {
    return res.status(400).json({ error: "templateId manquant" });
  }
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData manquant" });
  }
  debug.formData = formData;

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
      debug,
    });
  }

  const fieldMapping: Record<string, string> =
    tplRow.field_mapping && typeof tplRow.field_mapping === "object"
      ? (tplRow.field_mapping as Record<string, string>)
      : {};
  const storagePath: string = tplRow.storage_path ?? "";
  debug.field_mapping = fieldMapping;
  console.log("=== FORM DATA REÇU ===", JSON.stringify(formData, null, 2));
  console.log("=== FIELD MAPPING ===", JSON.stringify(fieldMapping, null, 2));
  console.log("=== MATCHES ===");
  for (const [pdfFieldName, standardKey] of Object.entries(fieldMapping)) {
    const value = standardKey ? formData[standardKey as string] : undefined;
    console.log(`${pdfFieldName} -> ${standardKey} -> ${value}`);
  }

  if (!storagePath) {
    return res
      .status(400)
      .json({ error: "storage_path vide pour ce template", debug });
  }

  if (Object.keys(fieldMapping).length === 0) {
    return res.status(400).json({
      error:
        "field_mapping vide pour ce template — relancez l'analyse du template",
      debug,
    });
  }

  const bucket = process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
  const { data: fileData, error: dlError } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (dlError || !fileData) {
    return res.status(500).json({
      error: `Téléchargement du PDF impossible : ${dlError?.message ?? "fichier introuvable"}`,
      debug,
    });
  }

  const pdfBytes = new Uint8Array(await fileData.arrayBuffer());

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const allFields = form.getFields();
    const allFieldNames = new Set(allFields.map((f) => f.getName()));
    const formDataKeys = new Set(Object.keys(formData));

    const mappingEntries = Object.entries(fieldMapping);
    const directScore = mappingEntries.reduce((acc, [pdfFieldName, standardKey]) => {
      const okPdf = allFieldNames.has(pdfFieldName);
      const okData = formDataKeys.has(standardKey);
      return acc + (okPdf && okData ? 1 : 0);
    }, 0);
    const reverseScore = mappingEntries.reduce((acc, [left, right]) => {
      const okPdf = allFieldNames.has(right);
      const okData = formDataKeys.has(left);
      return acc + (okPdf && okData ? 1 : 0);
    }, 0);

    const resolvedMapping: Record<string, string> =
      reverseScore > directScore
        ? Object.fromEntries(mappingEntries.map(([k, v]) => [v, k]))
        : fieldMapping;

    // Désactive le rich formatting quand possible pour éviter les erreurs
    // sur certains champs textuels (AcroForm RichText).
    for (const field of allFields) {
      try {
        if (field.constructor.name === "PDFTextField") {
          const textField = field as PDFTextField & {
            disableRichFormatting?: () => void;
          };
          if (typeof textField.disableRichFormatting === "function") {
            textField.disableRichFormatting();
          }
        }
      } catch {
        // Ignore silencieusement les champs qui ne supportent pas l'opération.
      }
    }

    let filledCount = 0;
    let skippedCount = 0;

    for (const [pdfFieldName, standardKey] of Object.entries(resolvedMapping)) {
      try {
        const rawValue = standardKey ? formData[standardKey] : undefined;
        const value = String(rawValue ?? "").trim();
        debug.matches.push({
          pdfFieldName,
          standardKey: standardKey ?? null,
          value,
        });
        if (!standardKey) {
          skippedCount += 1;
          continue;
        }

        const field = form.getField(pdfFieldName);
        if (field instanceof PDFTextField) {
          if (!value) {
            skippedCount += 1;
            continue;
          }
          field.setText(value);
          filledCount += 1;
          continue;
        }

        if (field instanceof PDFCheckBox) {
          const normalized = value.toLowerCase();
          const shouldCheck =
            normalized === "oui" ||
            normalized === "true" ||
            normalized === "1" ||
            normalized === "yes" ||
            normalized === "x" ||
            normalized === "on";
          if (shouldCheck) field.check();
          else field.uncheck();
          filledCount += 1;
          continue;
        }

        if (field instanceof PDFRadioGroup) {
          if (!value) {
            skippedCount += 1;
            continue;
          }
          field.select(value);
          filledCount += 1;
          continue;
        }

        if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
          if (!value) {
            skippedCount += 1;
            continue;
          }
          field.select(value);
          filledCount += 1;
          continue;
        }

        skippedCount += 1;
      } catch (e) {
        console.warn(`Champ ignoré: ${pdfFieldName}`, e);
        skippedCount += 1;
      }
    }

    console.log("[fill-pdf] Mapping score", {
      directScore,
      reverseScore,
      mappingInverted: reverseScore > directScore,
      filledCount,
      skippedCount,
      totalMappingEntries: Object.keys(resolvedMapping).length,
    });

    form.flatten();

    const filledBytes = await pdfDoc.save();
    const filledBase64 = Buffer.from(filledBytes).toString("base64");
    return res
      .status(200)
      .json({ pdfBase64: filledBase64, mapping: resolvedMapping, debug });
  } catch (err: any) {
    console.error("[fill-pdf] Erreur lors du remplissage", {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(500).json({
      error: err?.message ?? "Erreur pdf-lib lors du remplissage du PDF",
      stage: "pdf_fill",
      debug,
    });
  }
}

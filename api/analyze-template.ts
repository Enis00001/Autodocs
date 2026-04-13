import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  BON_DRAFT_KEYS,
  buildDeterministicFieldMapping,
} from "./pdfFieldMapping";

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
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function getStorageBucket(): string {
  return process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
}

async function loadPdfBytesFromRequest(body: Record<string, unknown>): Promise<Uint8Array> {
  const pdf_base64 = typeof body.pdf_base64 === "string" ? body.pdf_base64.trim() : "";
  if (pdf_base64) {
    const raw = pdf_base64.includes(",") ? pdf_base64.split(",").pop()! : pdf_base64;
    return Uint8Array.from(Buffer.from(raw, "base64"));
  }

  const storage_path = typeof body.storage_path === "string" ? body.storage_path.trim() : "";
  if (!storage_path) {
    throw new Error("Fournir storage_path (upload Storage) ou pdf_base64");
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Supabase admin requis pour télécharger le fichier depuis Storage");
  }

  const bucket = getStorageBucket();
  const { data, error } = await supabase.storage.from(bucket).download(storage_path);
  if (error || !data) {
    throw new Error(error?.message ?? "Téléchargement Storage impossible");
  }
  const ab = await data.arrayBuffer();
  return new Uint8Array(ab);
}

function sanitizeFieldMapping(
  raw: unknown,
  pdfFieldNames: string[],
  allowedKeys: Set<string>
): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const allowedPdf = new Set(pdfFieldNames);
  const out: Record<string, string> = {};
  for (const [pdfName, draftKey] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedPdf.has(pdfName)) continue;
    const key = String(draftKey ?? "").trim();
    if (!allowedKeys.has(key)) continue;
    out[pdfName] = key;
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? safeJsonParse<Record<string, unknown>>(req.body) : req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Corps JSON invalide" });
  }

  const dealer_id = body.dealer_id as string | undefined;
  const template_name = body.template_name as string | undefined;
  const storage_path = body.storage_path as string | undefined;

  if (!dealer_id?.trim()) {
    return res.status(400).json({ error: "dealer_id manquant" });
  }
  if (!template_name?.trim()) {
    return res.status(400).json({ error: "template_name manquant" });
  }
  if (!storage_path?.trim() && !body.pdf_base64) {
    return res.status(400).json({ error: "storage_path ou pdf_base64 requis" });
  }

  const pdf_field_names_override = body.pdf_field_names;
  const provided_mapping =
    body.field_mapping && typeof body.field_mapping === "object"
      ? (body.field_mapping as Record<string, unknown>)
      : null;

  const extraFormKeys = Array.isArray(body.vehicle_field_keys)
    ? (body.vehicle_field_keys as unknown[])
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
    : [];

  let field_mapping: Record<string, string> = {};
  let mapping_status: "pending" | "complete" | "failed" = "pending";
  let extractedNames: string[] = [];

  const allowedKeys = new Set<string>([
    ...BON_DRAFT_KEYS,
    ...extraFormKeys,
  ]);

  try {
    const pdfBytes = await loadPdfBytesFromRequest(body);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    let fields: ReturnType<typeof form.getFields>;
    try {
      fields = form.getFields();
    } catch (formErr: unknown) {
      console.warn("[analyze-template] getFields() indisponible (PDF complexe)", formErr);
      fields = [];
    }
    for (const field of fields) {
      try {
        extractedNames.push(field.getName());
      } catch {
        /* rich text / non supporté */
      }
    }

    if (Array.isArray(pdf_field_names_override) && pdf_field_names_override.length > 0) {
      extractedNames = pdf_field_names_override.map((x) => String(x));
    }

    if (provided_mapping) {
      field_mapping = sanitizeFieldMapping(provided_mapping, extractedNames, allowedKeys);
      mapping_status = Object.keys(field_mapping).length > 0 ? "complete" : "pending";
    } else if (extractedNames.length === 0) {
      field_mapping = {};
      mapping_status = "pending";
    } else {
      field_mapping = buildDeterministicFieldMapping(extractedNames, {
        extraFormKeys,
      });
      mapping_status = Object.keys(field_mapping).length > 0 ? "complete" : "pending";
    }
  } catch (loadErr: unknown) {
    console.error("[analyze-template] PDF load / extract failed", loadErr);
    return res.status(400).json({
      error: loadErr instanceof Error ? loadErr.message : "Erreur lecture PDF",
      stage: "pdf_extract",
    });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({
      error:
        "Supabase admin non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY requis pour l'insertion)",
    });
  }

  const { data, error } = await supabase
    .from("pdf_templates")
    .insert({
      dealer_id,
      template_name: template_name.trim(),
      storage_path: (storage_path ?? "").trim(),
      field_mapping,
      mapping_status,
    })
    .select("id, dealer_id, template_name, storage_path, field_mapping, mapping_status")
    .single();

  if (error) {
    console.error("[analyze-template] insert pdf_templates:", error);
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({
    ok: true,
    row: data,
    pdf_field_names: extractedNames,
  });
}

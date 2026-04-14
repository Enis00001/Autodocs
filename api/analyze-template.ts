import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  BON_DRAFT_KEYS,
  buildDeterministicFieldMapping,
} from "./_pdfFieldMapping";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type FieldInfo = {
  name: string;
  type: string;
  page: number | null;
  rect: { x: number; y: number; width: number; height: number } | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

function getStorageBucket(): string {
  return process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
}

async function loadPdfBytesFromRequest(
  body: Record<string, unknown>,
): Promise<Uint8Array> {
  const pdf_base64 =
    typeof body.pdf_base64 === "string" ? body.pdf_base64.trim() : "";
  if (pdf_base64) {
    const raw = pdf_base64.includes(",")
      ? pdf_base64.split(",").pop()!
      : pdf_base64;
    return Uint8Array.from(Buffer.from(raw, "base64"));
  }

  const storage_path =
    typeof body.storage_path === "string" ? body.storage_path.trim() : "";
  if (!storage_path) {
    throw new Error("Fournir storage_path (upload Storage) ou pdf_base64");
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error(
      "Supabase admin requis pour télécharger le fichier depuis Storage",
    );
  }

  const bucket = getStorageBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(storage_path);
  if (error || !data) {
    throw new Error(error?.message ?? "Téléchargement Storage impossible");
  }
  return new Uint8Array(await data.arrayBuffer());
}

function sanitizeFieldMapping(
  raw: unknown,
  pdfFieldNames: string[],
  allowedKeys: Set<string>,
): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const allowedPdf = new Set(pdfFieldNames);
  const out: Record<string, string> = {};
  for (const [pdfName, draftKey] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!allowedPdf.has(pdfName)) continue;
    const key = String(draftKey ?? "").trim();
    if (!allowedKeys.has(key)) continue;
    out[pdfName] = key;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  PDF field extraction with positions                                */
/* ------------------------------------------------------------------ */

function extractFieldInfos(pdfDoc: any): FieldInfo[] {
  const form = pdfDoc.getForm();
  let fields: any[];
  try {
    fields = form.getFields();
  } catch {
    return [];
  }

  const pages = pdfDoc.getPages();
  const pageRefStrings: string[] = pages.map((p: any) => {
    try {
      return p.ref?.toString() ?? "";
    } catch {
      return "";
    }
  });

  return fields.map((field: any) => {
    let rect: FieldInfo["rect"] = null;
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
        try {
          const pRef = widget.dict?.get(PDFName.of("P"));
          if (pRef) {
            const idx = pageRefStrings.indexOf(pRef.toString());
            if (idx >= 0) page = idx + 1;
          }
        } catch {}
      }
    } catch {}
    return {
      name: field.getName(),
      type: field.constructor.name,
      page,
      rect,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  OpenAI-based mapping (primary method)                              */
/* ------------------------------------------------------------------ */

const STANDARD_KEY_DESCRIPTIONS: Record<string, string> = {
  clientNom: "Nom de famille du client / acheteur",
  clientPrenom: "Prénom du client / acheteur",
  clientDateNaissance: "Date de naissance du client",
  clientNumeroCni: "Numéro de CNI ou pièce d'identité",
  clientAdresse: "Adresse postale complète du client",
  ribTitulaire: "Titulaire du compte bancaire (RIB)",
  ribIban: "Code IBAN",
  ribBic: "Code BIC / SWIFT",
  ribBanque: "Nom de la banque",
  clientEmail: "Adresse e-mail du client",
  clientTelephone: "Numéro de téléphone du client",
  vehiculeModele:
    "Marque, modèle, version ou désignation du véhicule (ex: Peugeot 308 GT)",
  vehiculeVin: "Numéro de châssis / VIN",
  vehiculePremiereCirculation: "Date de 1ère mise en circulation (MEC)",
  vehiculeKilometrage: "Kilométrage du véhicule",
  vehiculeCo2: "Émissions CO2 en g/km",
  vehiculeChevaux: "Puissance fiscale ou chevaux DIN",
  vehiculePrix: "Prix de vente TTC du véhicule",
  vehiculeCouleur: "Couleur / teinte du véhicule",
  vehiculeOptions: "Options et équipements du véhicule",
  vehiculeCarteGrise: "Numéro d'immatriculation / carte grise",
  vehiculeFraisReprise: "Frais de mise en état ou de reprise",
  vehiculeRemise: "Remise commerciale accordée",
  vehiculeFinancement:
    "Mode de financement (comptant, crédit, LOA, LLD, leasing)",
  vehiculeDateLivraison: "Date de livraison prévue",
  vehiculeReprise: "Montant de reprise de l'ancien véhicule",
  acompte: "Montant de l'acompte versé",
  modePaiement: "Mode de paiement (virement, chèque, CB)",
  apport: "Apport personnel",
  organismePreteur: "Organisme de crédit / prêteur",
  montantCredit: "Montant du crédit",
  tauxCredit: "Taux du crédit (TAEG)",
  dureeMois: "Durée du crédit en mois / nombre de mensualités",
  clauseSuspensive: "Clause suspensive d'obtention de financement",
  vendeurNom: "Nom du vendeur / commercial / conseiller",
  vendeurNotes: "Remarques ou commentaires internes du vendeur",
  optionsPrixTotal: "Prix total des options",
  optionsDetailJson: "Détail ligne par ligne des options",
};

async function callOpenAIChat(
  prompt: string,
  apiKey: string,
): Promise<string | null> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    console.warn(
      `[analyze-template] OpenAI API ${resp.status}:`,
      errText.slice(0, 300),
    );
    return null;
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? null;
}

async function buildMappingWithAI(
  fieldInfos: FieldInfo[],
  allowedKeys: Set<string>,
  extraFormKeys: string[] = [],
): Promise<Record<string, string> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[analyze-template] OPENAI_API_KEY absent → fallback regex");
    return null;
  }

  if (fieldInfos.length === 0) return null;

  const fieldLines = fieldInfos.map((f) => {
    const pos = f.rect
      ? `page ${f.page ?? "?"}, x=${Math.round(f.rect.x)}, y=${Math.round(f.rect.y)}, w=${Math.round(f.rect.width)}, h=${Math.round(f.rect.height)}`
      : "position inconnue";
    return `- "${f.name}" (${f.type}) — ${pos}`;
  });

  const keyLines = Object.entries(STANDARD_KEY_DESCRIPTIONS)
    .filter(([k]) => allowedKeys.has(k))
    .map(([k, desc]) => `- ${k}: ${desc}`);

  for (const k of extraFormKeys) {
    if (k && !keyLines.some((l) => l.startsWith(`- ${k}:`))) {
      keyLines.push(`- ${k}: Champ véhicule personnalisé de la concession`);
    }
  }

  const prompt = `Tu es un expert en formulaires PDF de bons de commande automobile français.

Voici les champs AcroForm extraits d'un template PDF, avec leur type et leur position sur la page (coordonnées en points PDF, origine = coin bas-gauche) :

${fieldLines.join("\n")}

Associe chaque champ PDF à la clé standard la plus appropriée parmi cette liste :

${keyLines.join("\n")}

RÈGLES :
1. Retourne UNIQUEMENT un objet JSON valide : { "nom_exact_champ_pdf": "cle_standard" }
2. Utilise les noms de champs PDF EXACTEMENT comme écrits ci-dessus (casse et espaces inclus)
3. N'inclus QUE les associations dont tu es confiant — mieux vaut en omettre qu'en inventer
4. Si les noms sont génériques (Texte1, Text2, Field3…), utilise la position sur la page pour deviner : les infos client sont généralement en haut, le véhicule au milieu, le financement en bas
5. Chaque clé standard ne doit apparaître qu'UNE seule fois (pas de doublons)
6. Les champs de type PDFCheckBox ou PDFRadioGroup correspondent souvent à clauseSuspensive, optionsMode, modePaiement, vehiculeFinancement`;

  try {
    const content = await callOpenAIChat(prompt, apiKey);
    if (!content) {
      console.warn("[analyze-template] OpenAI returned empty content");
      return null;
    }

    console.log("[analyze-template] OpenAI raw mapping:", content);

    const raw = JSON.parse(content) as Record<string, unknown>;
    const fieldNameSet = new Set(fieldInfos.map((f) => f.name));
    const usedKeys = new Set<string>();
    const validated: Record<string, string> = {};

    for (const [pdfName, key] of Object.entries(raw)) {
      const keyStr = String(key ?? "").trim();
      if (!fieldNameSet.has(pdfName)) continue;
      if (!allowedKeys.has(keyStr)) continue;
      if (usedKeys.has(keyStr)) continue;
      validated[pdfName] = keyStr;
      usedKeys.add(keyStr);
    }

    console.log(
      "[analyze-template] Validated AI mapping:",
      JSON.stringify(validated, null, 2),
    );
    return Object.keys(validated).length > 0 ? validated : null;
  } catch (err) {
    console.warn(
      "[analyze-template] OpenAI mapping failed → fallback regex",
      err,
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
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

  const dealer_id = body.dealer_id as string | undefined;
  const template_name = body.template_name as string | undefined;
  const storage_path = body.storage_path as string | undefined;
  const template_id = body.template_id as string | undefined;

  const isReanalyze = !!template_id?.trim();

  if (!isReanalyze) {
    if (!dealer_id?.trim())
      return res.status(400).json({ error: "dealer_id manquant" });
    if (!template_name?.trim())
      return res.status(400).json({ error: "template_name manquant" });
    if (!storage_path?.trim() && !body.pdf_base64)
      return res
        .status(400)
        .json({ error: "storage_path ou pdf_base64 requis" });
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
  let mapping_method: "provided" | "ai" | "regex" | "none" = "none";

  const allowedKeys = new Set<string>([
    ...(BON_DRAFT_KEYS as unknown as string[]),
    ...extraFormKeys,
  ]);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({
      error:
        "Supabase admin non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY requis)",
    });
  }

  let pdfBytes: Uint8Array;

  try {
    if (isReanalyze) {
      const { data: existing, error: fetchErr } = await supabase
        .from("pdf_templates")
        .select("storage_path")
        .eq("id", template_id)
        .single();
      if (fetchErr || !existing) {
        return res.status(404).json({
          error: `Template introuvable (id=${template_id})`,
          details: fetchErr,
        });
      }
      const bucket = getStorageBucket();
      const { data: fileData, error: dlError } = await supabase.storage
        .from(bucket)
        .download(existing.storage_path);
      if (dlError || !fileData) {
        throw new Error(
          dlError?.message ?? "Téléchargement Storage impossible",
        );
      }
      pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    } else {
      pdfBytes = await loadPdfBytesFromRequest(body);
    }

    const pdfDoc = await PDFDocument.load(pdfBytes);
    const fieldInfos = extractFieldInfos(pdfDoc);
    extractedNames = fieldInfos.map((f) => f.name);

    if (
      Array.isArray(pdf_field_names_override) &&
      pdf_field_names_override.length > 0
    ) {
      extractedNames = pdf_field_names_override.map((x: unknown) => String(x));
    }

    if (provided_mapping) {
      field_mapping = sanitizeFieldMapping(
        provided_mapping,
        extractedNames,
        allowedKeys,
      );
      mapping_method = "provided";
      mapping_status =
        Object.keys(field_mapping).length > 0 ? "complete" : "pending";
    } else if (extractedNames.length === 0) {
      field_mapping = {};
      mapping_status = "pending";
    } else {
      const aiMapping = await buildMappingWithAI(
        fieldInfos,
        allowedKeys,
        extraFormKeys,
      );

      if (aiMapping && Object.keys(aiMapping).length > 0) {
        field_mapping = aiMapping;
        mapping_method = "ai";
        mapping_status = "complete";
      } else {
        field_mapping = buildDeterministicFieldMapping(extractedNames, {
          extraFormKeys,
        });
        mapping_method = "regex";
        mapping_status =
          Object.keys(field_mapping).length > 0 ? "complete" : "pending";
      }
    }
  } catch (loadErr: unknown) {
    console.error("[analyze-template] PDF load / extract failed", loadErr);
    return res.status(400).json({
      error:
        loadErr instanceof Error ? loadErr.message : "Erreur lecture PDF",
      stage: "pdf_extract",
    });
  }

  if (isReanalyze) {
    const { data, error } = await supabase
      .from("pdf_templates")
      .update({ field_mapping, mapping_status })
      .eq("id", template_id)
      .select(
        "id, dealer_id, template_name, storage_path, field_mapping, mapping_status",
      )
      .single();

    if (error) {
      console.error("[analyze-template] update pdf_templates:", error);
      return res.status(500).json({ error: error.message, details: error });
    }

    return res.status(200).json({
      ok: true,
      row: data,
      pdf_field_names: extractedNames,
      mapping_method,
      reanalyzed: true,
    });
  }

  const { data, error } = await supabase
    .from("pdf_templates")
    .insert({
      dealer_id,
      template_name: template_name!.trim(),
      storage_path: (storage_path ?? "").trim(),
      field_mapping,
      mapping_status,
    })
    .select(
      "id, dealer_id, template_name, storage_path, field_mapping, mapping_status",
    )
    .single();

  if (error) {
    console.error("[analyze-template] insert pdf_templates:", error);
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({
    ok: true,
    row: data,
    pdf_field_names: extractedNames,
    mapping_method,
  });
}

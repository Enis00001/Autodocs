import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function safeJsonParse<T>(value: string): T | null {
  try { return JSON.parse(value) as T; } catch { return null; }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type FieldInfo = {
  name: string;
  type: string;
  page: number | null;
  rect: { x: number; y: number; width: number; height: number } | null;
};

function extractFieldInfos(pdfDoc: any): FieldInfo[] {
  const form = pdfDoc.getForm();
  let fields: any[];
  try { fields = form.getFields(); } catch { return []; }

  const pages = pdfDoc.getPages();
  const pageRefStrings: string[] = pages.map((p: any) => {
    try { return p.ref?.toString() ?? ""; } catch { return ""; }
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
    return { name: field.getName(), type: field.constructor.name, page, rect };
  });
}

/* ================================================================== */
/*  DATA DESCRIPTIONS (for the AI prompt)                              */
/* ================================================================== */

const KEY_DESCRIPTIONS: Record<string, string> = {
  clientNom: "Nom de famille du client / acheteur",
  clientPrenom: "Prénom du client",
  clientDateNaissance: "Date de naissance du client",
  clientNumeroCni: "Numéro de CNI / pièce d'identité",
  clientAdresse: "Adresse postale complète du client",
  clientEmail: "Adresse e-mail du client",
  clientTelephone: "Numéro de téléphone du client",
  ribTitulaire: "Titulaire du compte bancaire (RIB)",
  ribIban: "Code IBAN",
  ribBic: "Code BIC / SWIFT",
  ribBanque: "Nom de la banque",
  vehiculeModele: "Modèle / désignation du véhicule",
  vehiculeVin: "Numéro VIN / châssis",
  vehiculePremiereCirculation: "Date 1ère mise en circulation",
  vehiculeKilometrage: "Kilométrage du véhicule",
  vehiculeCo2: "Émissions CO2 (g/km)",
  vehiculeChevaux: "Puissance (chevaux / CV)",
  vehiculePrix: "Prix de vente TTC du véhicule (€)",
  vehiculeCouleur: "Couleur / teinte du véhicule",
  vehiculeOptions: "Options / équipements",
  vehiculeCarteGrise: "N° immatriculation / carte grise",
  vehiculeFraisReprise: "Frais de reprise (€)",
  vehiculeRemise: "Remise commerciale (€)",
  vehiculeFinancement: "Type de financement (comptant, crédit, LOA, LLD)",
  vehiculeDateLivraison: "Date de livraison prévue",
  vehiculeReprise: "Montant de reprise ancien véhicule (€)",
  acompte: "Montant de l'acompte (€)",
  modePaiement: "Mode de paiement (virement, chèque, CB)",
  apport: "Apport personnel (€)",
  organismePreteur: "Organisme de crédit / prêteur",
  montantCredit: "Montant du crédit (€)",
  tauxCredit: "Taux du crédit (TAEG %)",
  dureeMois: "Durée du crédit (mois)",
  clauseSuspensive: "Clause suspensive d'obtention de financement",
  vendeurNom: "Nom du vendeur / commercial",
  vendeurNotes: "Notes / remarques du vendeur",
  optionsPrixTotal: "Prix total des options (€)",
  optionsDetailJson: "Détail des options",
};

/* ================================================================== */
/*  AI MAPPING — maps form data directly to PDF fields at fill time    */
/* ================================================================== */

async function buildLiveMapping(
  fieldInfos: FieldInfo[],
  formData: Record<string, unknown>,
): Promise<Record<string, string> | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[fill-pdf] OPENAI_API_KEY absent → skip AI mapping");
    return null;
  }

  const textFields = fieldInfos.filter(
    (f) => f.type === "PDFTextField" && f.rect,
  );
  if (textFields.length === 0) return null;

  const dataEntries: Array<{ key: string; value: string; desc: string }> = [];
  for (const [key, rawVal] of Object.entries(formData)) {
    const val = String(rawVal ?? "").trim();
    if (!val) continue;
    if (key === "templateId" || key === "optionsMode" || key === "optionsDetailJson") continue;
    const desc = KEY_DESCRIPTIONS[key] ?? key.replace(/_/g, " ");
    dataEntries.push({ key, value: val, desc });
  }
  if (dataEntries.length === 0) return null;

  const fieldLines = textFields
    .sort((a, b) => {
      const pa = a.page ?? 1;
      const pb = b.page ?? 1;
      if (pa !== pb) return pa - pb;
      return (b.rect?.y ?? 0) - (a.rect?.y ?? 0);
    })
    .map((f, i) => {
      const pos = f.rect
        ? `page ${f.page ?? "?"}, x=${Math.round(f.rect.x)}, y=${Math.round(f.rect.y)}, largeur=${Math.round(f.rect.width)}`
        : "position inconnue";
      return `${i + 1}. "${f.name}" — ${pos}`;
    });

  const dataLines = dataEntries.map(
    (d) => `- "${d.key}" = "${d.value}" (${d.desc})`,
  );

  const prompt = [
    "Tu es un expert en bons de commande automobile français.",
    "",
    "Voici les champs texte AcroForm d'un PDF de bon de commande, triés du haut vers le bas de chaque page.",
    "Les coordonnées sont en points PDF (origine = coin bas-gauche). Un y élevé = haut de page.",
    "",
    fieldLines.join("\n"),
    "",
    "Voici les données à remplir dans ce bon (clé = valeur, avec description) :",
    "",
    dataLines.join("\n"),
    "",
    "RÈGLES STRICTES :",
    '1. Retourne UNIQUEMENT un JSON valide : { "nom_exact_champ_pdf": "cle_donnee" }',
    "2. Utilise les noms de champs PDF EXACTEMENT comme écrits ci-dessus",
    "3. Utilise les clés de données EXACTEMENT comme écrites ci-dessus",
    "4. Sur un bon de commande automobile français typique :",
    "   - HAUT de page (y > 600) : infos client (nom, prénom, adresse, date naissance, CNI, téléphone, email)",
    "   - MILIEU (300 < y < 600) : infos véhicule (marque, modèle, VIN, immatriculation, kilométrage, prix, couleur, énergie)",
    "   - BAS (y < 300) : financement, acompte, mode de paiement, vendeur, signature",
    "5. Chaque clé de donnée ne doit apparaître qu'UNE seule fois",
    "6. Chaque champ PDF ne doit recevoir qu'UNE seule donnée",
    "7. N'associe QUE les paires dont tu es SÛR",
    "8. Les valeurs numériques pures (comme un prix '32900') vont dans des champs financiers",
    "9. Les valeurs qui ressemblent à des plaques (ex: 'FH-949-FJ') sont des immatriculations",
    "10. Les valeurs qui ressemblent à des noms propres (ex: 'MARTIN', 'Jean') sont des infos client",
    "11. Les noms de marques auto (Porsche, Peugeot, Renault...) sont des infos véhicule",
  ].join("\n");

  try {
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
      const t = await resp.text().catch(() => "");
      console.warn(`[fill-pdf] OpenAI ${resp.status}: ${t.slice(0, 300)}`);
      return null;
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) return null;

    console.log("[fill-pdf] AI live mapping raw:", content);

    const raw = JSON.parse(content) as Record<string, unknown>;
    const pdfNames = new Set(fieldInfos.map((f) => f.name));
    const dataKeys = new Set(dataEntries.map((d) => d.key));
    const usedDataKeys = new Set<string>();
    const validated: Record<string, string> = {};

    for (const [pdfName, dataKey] of Object.entries(raw)) {
      const dk = String(dataKey ?? "").trim();
      if (!pdfNames.has(pdfName)) continue;
      if (!dataKeys.has(dk)) continue;
      if (usedDataKeys.has(dk)) continue;
      validated[pdfName] = dk;
      usedDataKeys.add(dk);
    }

    console.log("[fill-pdf] AI validated mapping:", JSON.stringify(validated, null, 2));
    return Object.keys(validated).length > 0 ? validated : null;
  } catch (err) {
    console.warn("[fill-pdf] AI mapping failed:", err);
    return null;
  }
}

/* ================================================================== */
/*  FALLBACK — use stored mapping + alias bridge for custom keys       */
/* ================================================================== */

const STANDARD_KEY_ALIASES: Record<string, string[]> = {
  vehiculeModele: ["modele", "model", "designation", "version", "type_vehicule", "gamme"],
  vehiculeVin: ["vin", "chassis", "serie", "n_serie", "numero_serie", "n_de_serie"],
  vehiculeCarteGrise: ["immat", "immatriculation", "carte_grise", "plaque"],
  vehiculePrix: ["prix", "prix_vente", "prix_de_vente", "tarif", "montant_ttc"],
  vehiculeKilometrage: ["km", "kilometrage", "odometre"],
  vehiculeCo2: ["co2", "emission", "emissions"],
  vehiculeChevaux: ["chevaux", "cv", "puissance", "din", "puissance_fiscale"],
  vehiculeCouleur: ["couleur", "teinte", "coloris"],
  vehiculePremiereCirculation: ["mec", "mise_en_circulation", "premiere_circulation", "date_mec"],
  vehiculeFinancement: ["financement", "type_financement"],
  vehiculeDateLivraison: ["livraison", "date_livraison"],
  vehiculeReprise: ["reprise", "vehicule_reprise", "montant_reprise"],
  vehiculeRemise: ["remise", "remise_commerciale", "discount"],
  vehiculeFraisReprise: ["frais_reprise", "frais_mise", "frais"],
  vehiculeOptions: ["options", "equipements"],
  acompte: ["acompte", "arrhes"],
  apport: ["apport", "apport_personnel"],
  modePaiement: ["mode_paiement", "paiement", "reglement"],
  organismePreteur: ["organisme", "preteur", "banque_pret"],
  montantCredit: ["montant_credit", "capital"],
  tauxCredit: ["taux", "taux_credit", "taeg"],
  dureeMois: ["duree", "duree_mois", "mensualites"],
  vendeurNom: ["vendeur", "commercial", "conseiller"],
  vendeurNotes: ["notes_vendeur", "commentaire", "remarques"],
  clientNom: ["nom", "nom_client"],
  clientPrenom: ["prenom", "prenom_client"],
  clientAdresse: ["adresse", "adresse_client"],
  clientEmail: ["email", "mail", "courriel"],
  clientTelephone: ["telephone", "tel", "mobile", "portable"],
  clientDateNaissance: ["date_naissance", "naissance", "ddn"],
  clientNumeroCni: ["cni", "identite", "numero_cni"],
  ribIban: ["iban"],
  ribBic: ["bic", "swift"],
  ribTitulaire: ["titulaire", "titulaire_compte"],
  ribBanque: ["banque", "nom_banque"],
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveValue(
  standardKey: string,
  formData: Record<string, unknown>,
): string {
  const direct = String(formData[standardKey] ?? "").trim();
  if (direct) return direct;

  const aliases = STANDARD_KEY_ALIASES[standardKey];
  if (!aliases) return "";

  const normAliases = aliases.map(norm);
  for (const [k, v] of Object.entries(formData)) {
    const val = String(v ?? "").trim();
    if (!val) continue;
    const nk = norm(k);
    if (nk.length < 2) continue;
    for (const na of normAliases) {
      if (nk === na || (na.length >= 3 && nk.includes(na)) || (nk.length >= 3 && na.includes(nk))) {
        return val;
      }
    }
  }
  return "";
}

/* ================================================================== */
/*  FILL — writes values into PDF fields                               */
/* ================================================================== */

function fillField(
  form: any,
  pdfFieldName: string,
  value: string,
): boolean {
  if (!value) return false;
  try {
    const field = form.getField(pdfFieldName);

    if (field instanceof PDFTextField) {
      try {
        const tf = field as PDFTextField & { disableRichFormatting?: () => void };
        if (typeof tf.disableRichFormatting === "function") tf.disableRichFormatting();
      } catch {}
      field.setText(value);
      return true;
    }

    if (field instanceof PDFCheckBox) {
      const n = value.toLowerCase();
      if (["oui", "true", "1", "yes", "x", "on"].includes(n)) field.check();
      else field.uncheck();
      return true;
    }

    if (field instanceof PDFRadioGroup) {
      field.select(value);
      return true;
    }

    if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      field.select(value);
      return true;
    }
  } catch (e) {
    console.warn(`[fill-pdf] Champ ignoré: ${pdfFieldName}`, e);
  }
  return false;
}

/* ================================================================== */
/*  MAIN HANDLER                                                       */
/* ================================================================== */

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
      error: "Supabase non configuré (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY requis)",
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

  const storedMapping: Record<string, string> =
    tplRow.field_mapping && typeof tplRow.field_mapping === "object"
      ? (tplRow.field_mapping as Record<string, string>)
      : {};
  const storagePath: string = tplRow.storage_path ?? "";

  if (!storagePath) {
    return res.status(400).json({ error: "storage_path vide pour ce template" });
  }

  const bucket = process.env.SUPABASE_PDF_TEMPLATES_BUCKET ?? "pdf-templates";
  const { data: fileData, error: dlError } = await supabase.storage
    .from(bucket)
    .download(storagePath);

  if (dlError || !fileData) {
    return res.status(500).json({
      error: `Téléchargement PDF impossible : ${dlError?.message ?? "fichier introuvable"}`,
    });
  }

  const pdfBytes = new Uint8Array(await fileData.arrayBuffer());

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const fieldInfos = extractFieldInfos(pdfDoc);

    let filledCount = 0;
    let method: "ai-live" | "stored+fallback" = "stored+fallback";

    /* ---- Strategy 1: AI live mapping (best) ---- */
    const liveMapping = await buildLiveMapping(fieldInfos, formData);

    if (liveMapping && Object.keys(liveMapping).length > 0) {
      method = "ai-live";
      for (const [pdfFieldName, dataKey] of Object.entries(liveMapping)) {
        const value = String(formData[dataKey] ?? "").trim();
        if (fillField(form, pdfFieldName, value)) filledCount++;
      }

      console.log(`[fill-pdf] AI-live: rempli ${filledCount} champs`);

      if (filledCount >= 3) {
        supabase
          .from("pdf_templates")
          .update({ field_mapping: liveMapping, mapping_status: "complete" })
          .eq("id", templateId)
          .then(({ error: upErr }) => {
            if (upErr) console.warn("[fill-pdf] Failed to cache mapping:", upErr);
            else console.log("[fill-pdf] Cached AI mapping for future use");
          });
      }
    }

    /* ---- Strategy 2: Stored mapping + alias fallback ---- */
    if (filledCount === 0 && Object.keys(storedMapping).length > 0) {
      for (const [pdfFieldName, standardKey] of Object.entries(storedMapping)) {
        const value = resolveValue(standardKey, formData);
        if (fillField(form, pdfFieldName, value)) filledCount++;
      }
      console.log(`[fill-pdf] Stored+fallback: rempli ${filledCount} champs`);
    }

    form.flatten();

    const filledBytes = await pdfDoc.save();
    const filledBase64 = Buffer.from(filledBytes).toString("base64");

    const debug = {
      method,
      filledCount,
      totalPdfFields: fieldInfos.length,
      liveMapping: liveMapping ? Object.keys(liveMapping).length : 0,
      storedMapping: Object.keys(storedMapping).length,
    };

    console.log("[fill-pdf] Résultat:", debug);

    return res.status(200).json({ pdfBase64: filledBase64, debug });
  } catch (err: any) {
    console.error("[fill-pdf] Erreur:", err?.message, err?.stack);
    return res.status(500).json({
      error: err?.message ?? "Erreur pdf-lib lors du remplissage",
    });
  }
}

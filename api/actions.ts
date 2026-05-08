import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/* ==================================================================
 *  Supabase admin / auth helpers (ex api/_lib/supabase-admin.ts)
 *  Inlinés pour éviter ERR_MODULE_NOT_FOUND sur Vercel ESM serverless.
 * ================================================================== */

const FALLBACK_APP_URL = "https://autodocs-eight.vercel.app";

function getSupabaseUrl(): string | null {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || null;
}

function getSupabaseAnonKey(): string | null {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || null;
}

async function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Configuration Supabase incomplète côté serveur (URL ou SERVICE_ROLE_KEY).");
  }
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key);
}

async function getAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;

  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  if (!url || !anon) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, anon);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

function getPublicAppUrl(req?: VercelRequest): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  if (req) {
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined);
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    if (host) return `${proto}://${host}`;
  }

  return FALLBACK_APP_URL;
}

/* ==================================================================
 *  Bon-template inliné (ex api/_lib/bon-template.ts)
 *  Inliné pour éviter ERR_MODULE_NOT_FOUND sur Vercel ESM serverless.
 * ================================================================== */

const BON_TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a2e; line-height: 1.45; }
  .page { width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2c3e8f; padding-bottom: 14px; margin-bottom: 18px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .logo-placeholder { width: 54px; height: 54px; border: 2px dashed #c8cde0; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #9ea3b8; font-size: 9px; text-align: center; line-height: 1.1; }
  .concession-block h1 { font-size: 18px; font-weight: 800; color: #2c3e8f; letter-spacing: -0.3px; }
  .concession-block .subtitle { font-size: 10px; color: #666; margin-top: 2px; }
  .header-right { text-align: right; font-size: 10px; color: #555; }
  .header-right .ref { font-size: 13px; font-weight: 700; color: #2c3e8f; }
  .header-right .doc-title { font-size: 16px; font-weight: 800; color: #1a1a2e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #fff; background: #2c3e8f; padding: 6px 10px; }
  table { width: 100%; border-collapse: collapse; }
  table td, table th { padding: 5px 8px; border: 1px solid #d0d4e4; font-size: 10.5px; vertical-align: top; }
  table th { background: #eef0f8; font-weight: 600; color: #333; text-align: left; width: 38%; white-space: nowrap; }
  .reglement { border: 1px solid #d0d4e4; padding: 10px 12px; }
  .reglement-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
  .reglement-row.negative .value { color: #b34242; }
  .reglement-row .value { font-weight: 600; }
  .reglement-row.net { font-weight: 800; font-size: 13px; background: #eef0f8; padding: 6px 10px; margin: 4px -2px; border: 2px solid #2c3e8f; }
  .reglement-row.solde { font-weight: 800; font-size: 12px; border-top: 1px dashed #c0c5d8; padding-top: 6px; margin-top: 2px; }
  .mode-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; background: #2c3e8f; color: #fff; letter-spacing: 0.4px; text-transform: uppercase; }
  .signatures { display: flex; gap: 20px; margin-top: 20px; }
  .sig-box { flex: 1; border: 1px solid #d0d4e4; padding: 10px; min-height: 90px; }
  .sig-box .sig-title { font-size: 10px; font-weight: 700; color: #2c3e8f; margin-bottom: 4px; }
  .sig-box .sig-name { font-size: 10px; margin-bottom: 4px; }
  .sig-box .sig-date { font-size: 9px; color: #888; margin-top: 6px; }
  .sig-zone { min-height: 80px; border: 1px dashed #ccc; margin-top: 8px; position: relative; padding: 4px; display: flex; align-items: center; justify-content: center; }
  .sig-zone img { max-width: 200px; max-height: 80px; display: block; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d0d4e4; font-size: 8.5px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <div class="logo-placeholder">LOGO</div>
      <div class="concession-block">
        <h1>{{concessionNom}}</h1>
        <div class="subtitle">Véhicule d'occasion / neuf</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-title">Bon de commande</div>
      <div class="ref">N° {{bonNumero}}</div>
      <div>Date : {{bonDate}}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Acheteur</div>
    <table>
      <tr>
        <th>Nom</th><td>{{clientNom}}</td>
        <th>Prénom</th><td>{{clientPrenom}}</td>
      </tr>
      <tr>
        <th>Date de naissance</th><td colspan="3">{{clientDateNaissance}}</td>
      </tr>
    </table>
  </div>

  <!--VEHICULE_SECTION_START-->
  <div class="section">
    <div class="section-title">Véhicule vendu</div>
    <table>
      {{vehiculeRowsHtml}}
    </table>
  </div>
  <!--VEHICULE_SECTION_END-->

  <!--REPRISE_SECTION_START-->
  <div class="section">
    <div class="section-title">Reprise véhicule</div>
    <table>
      <tr>
        <th>Véhicule repris</th>
        <td colspan="3">{{reprise_marque}} {{reprise_modele}} — Plaque : <strong>{{reprise_plaque}}</strong></td>
      </tr>
      <tr>
        <th>N° VIN / Châssis</th>
        <td colspan="3">{{reprise_vin}}</td>
      </tr>
      <tr>
        <th>Première circulation</th>
        <td colspan="3">{{reprise_premiere_circulation}}</td>
      </tr>
      <tr>
        <th>Valeur de reprise déduite</th>
        <td colspan="3"><strong style="color:#b34242;">- {{reprise_valeur}} €</strong></td>
      </tr>
      <!--REPRISE_DUREE_ROW_START-->
      <tr>
        <th>Durée</th>
        <td colspan="3">{{reprise_duree_mois}} mois</td>
      </tr>
      <!--REPRISE_DUREE_ROW_END-->
    </table>
  </div>
  <!--REPRISE_SECTION_END-->

  <div class="section">
    <div class="section-title">Règlement</div>
    <div class="reglement">
      <div class="reglement-row">
        <span>Prix véhicule TTC</span>
        <span class="value">{{vehiculePrix}} €</span>
      </div>
      <!--REMISE_ROW_START-->
      <div class="reglement-row negative">
        <span>Remise accordée</span>
        <span class="value">- {{vehiculeRemise}} €</span>
      </div>
      <!--REMISE_ROW_END-->
      <!--REPRISE_ROW_START-->
      <div class="reglement-row negative">
        <span>Reprise véhicule ancien</span>
        <span class="value">- {{reprise_valeur}} €</span>
      </div>
      <!--REPRISE_ROW_END-->
      <div class="reglement-row net">
        <span>Net à payer TTC</span>
        <span class="value">{{netAPayer}} €</span>
      </div>
      <!--ACOMPTE_BLOCK_START-->
      <div class="reglement-row">
        <span>Acompte versé</span>
        <span class="value">- {{acompte}} €</span>
      </div>
      <div class="reglement-row solde">
        <span>Solde restant dû à la livraison</span>
        <span class="value">{{solde}} €</span>
      </div>
      <!--ACOMPTE_BLOCK_END-->
      <div class="reglement-row" style="margin-top: 10px;">
        <span>Mode de paiement</span>
        <span class="mode-pill">{{modePaiementLabel}}</span>
      </div>
      <div class="reglement-row">
        <span>Date de livraison prévue</span>
        <span class="value">{{vehiculeDateLivraison}}</span>
      </div>
    </div>
  </div>
  <!--CUSTOM_FIELDS_SECTION_START-->
  <div class="section">
    <div class="section-title">Champs personnalisés</div>
    <table>
      {{customFieldsRowsHtml}}
    </table>
  </div>
  <!--CUSTOM_FIELDS_SECTION_END-->

  <div class="signatures">
    <div class="sig-box" id="zone-signature-client">
      <div class="sig-title">L'acheteur</div>
      <div class="sig-name">{{clientPrenom}} {{clientNom}}</div>
      <div style="font-size: 9px; color: #666;">Lu et approuvé, bon pour accord</div>
      <div class="sig-zone">{{signature_client}}</div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
    <div class="sig-box" id="zone-signature-vendeur">
      <div class="sig-title">Le vendeur</div>
      <div class="sig-name">{{concessionNom}}</div>
      <div style="font-size: 9px; color: #666;">Cachet & signature</div>
      <div class="sig-zone">{{signature_vendeur}}</div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
  </div>

  <div class="footer">
    Ce bon de commande constitue un engagement ferme et définitif entre les parties, sous réserve des conditions suspensives éventuellement indiquées.
    Conformément aux articles L. 221-18 et suivants du Code de la consommation, l'acheteur dispose d'un délai de rétractation de 14 jours pour les ventes à distance.
  </div>

</div>
</body>
</html>`;

type SignatureImages = {
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
};

function escapeHtmlTemplate(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseNum(s: string): number {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stripBlock(html: string, startMarker: string, endMarker: string): string {
  const re = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "g");
  return html.replace(re, "");
}

function keepBlock(html: string, startMarker: string, endMarker: string): string {
  return html
    .replace(new RegExp(startMarker, "g"), "")
    .replace(new RegExp(endMarker, "g"), "");
}

function parseJsonMaybe<T = unknown>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

function parseStringArray(raw: unknown): string[] {
  const v = parseJsonMaybe<unknown>(raw);
  const source = Array.isArray(v) ? v : Array.isArray(raw) ? raw : [];
  return (source as unknown[]).filter(
    (x): x is string => typeof x === "string" && x.trim() !== "",
  );
}

function parseStringDict(raw: unknown): Record<string, string> {
  const v = parseJsonMaybe<unknown>(raw);
  const source =
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!source) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(source)) {
    if (typeof k !== "string" || !k) continue;
    if (val === null || val === undefined) continue;
    out[k] = String(val);
  }
  return out;
}

function buildVehiculeRowsHtml(
  donnees: Record<string, string>,
  colonnes: string[],
): string {
  const rows: string[] = [];
  const order = colonnes.length > 0 ? colonnes : Object.keys(donnees);
  for (const key of order) {
    const rawValue = donnees[key];
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    rows.push(
      `<tr><th>${escapeHtmlTemplate(key)}</th><td colspan="3">${escapeHtmlTemplate(value)}</td></tr>`,
    );
  }
  return rows.join("\n");
}

function buildCustomFieldsRowsHtml(
  defs: Array<Record<string, unknown>>,
  values: Record<string, string>,
): string {
  const sectionLabel: Record<string, string> = {
    client: "Client",
    vehicule: "Véhicule",
    reprise: "Reprise",
    reglement: "Règlement",
  };
  const rows: string[] = [];
  for (const def of defs) {
    const key = String(def.key ?? "");
    const label = String(def.label ?? "").trim();
    const section = String(def.section ?? "");
    const enabled = Boolean(def.enabled);
    const isCustom = Boolean(def.isCustom);
    if (!enabled || !isCustom || !key || !label) continue;
    const v = String(values[key] ?? "").trim();
    if (!v) continue;
    rows.push(
      `<tr><th>${escapeHtmlTemplate(sectionLabel[section] ?? section)} — ${escapeHtmlTemplate(label)}</th><td colspan="3">${escapeHtmlTemplate(v)}</td></tr>`,
    );
  }
  return rows.join("\n");
}

function buildSignatureImg(rawBase64: string | undefined): string {
  const trimmed = String(rawBase64 ?? "").trim();
  if (!trimmed) return "";
  const src = /^data:image\//i.test(trimmed)
    ? trimmed
    : `data:image/png;base64,${trimmed.replace(/^data:[^,]+,/, "")}`;
  return `<img src="${src}" alt="signature" style="max-width:200px;max-height:80px;" />`;
}

function buildHtml(
  formData: Record<string, string>,
  signatures: SignatureImages = {},
): string {
  let html = BON_TEMPLATE_HTML;

  const get = (key: string) => escapeHtmlTemplate((formData[key] ?? "").trim());

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero =
    String(formData.bonNumero ?? "").trim() ||
    `BC-${Date.now().toString(36).toUpperCase()}`;

  const prix = parseNum(formData.vehiculePrix);
  const remise = parseNum(formData.vehiculeRemise);
  const repriseValeur = parseNum(formData.reprise_valeur);
  const repriseActive = repriseValeur > 0;
  const netAPayer = Math.max(0, prix - remise - repriseValeur);
  const acompte = parseNum(formData.acompte);
  const solde = Math.max(0, netAPayer - acompte);

  const repriseDureeMoisRaw = (formData.reprise_duree_mois ?? "").trim();
  const hasRepriseDuree = repriseDureeMoisRaw !== "" && parseNum(repriseDureeMoisRaw) > 0;

  if (repriseActive) {
    html = keepBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = keepBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
    if (hasRepriseDuree) {
      html = keepBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
    } else {
      html = stripBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
    }
  } else {
    html = stripBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = stripBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
    html = stripBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
  }

  if (remise > 0) {
    html = keepBlock(html, "<!--REMISE_ROW_START-->", "<!--REMISE_ROW_END-->");
  } else {
    html = stripBlock(html, "<!--REMISE_ROW_START-->", "<!--REMISE_ROW_END-->");
  }

  if (acompte > 0) {
    html = keepBlock(html, "<!--ACOMPTE_BLOCK_START-->", "<!--ACOMPTE_BLOCK_END-->");
  } else {
    html = stripBlock(html, "<!--ACOMPTE_BLOCK_START-->", "<!--ACOMPTE_BLOCK_END-->");
  }

  const donnees = parseStringDict(formData.stock_donnees);
  const colonnes = parseStringArray(formData.stock_colonnes);
  const vehiculeRowsHtml = buildVehiculeRowsHtml(donnees, colonnes);
  const customDefs =
    parseJsonMaybe<Array<Record<string, unknown>>>(formData.custom_fields_defs) ?? [];
  const customValues = parseStringDict(formData.custom_fields_values);
  const customFieldsRowsHtml = buildCustomFieldsRowsHtml(customDefs, customValues);

  if (vehiculeRowsHtml.trim().length > 0) {
    html = keepBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  }
  if (customFieldsRowsHtml.trim().length > 0) {
    html = keepBlock(html, "<!--CUSTOM_FIELDS_SECTION_START-->", "<!--CUSTOM_FIELDS_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--CUSTOM_FIELDS_SECTION_START-->", "<!--CUSTOM_FIELDS_SECTION_END-->");
  }

  const modeRaw = (formData.modePaiement ?? "").trim().toLowerCase();
  const modePaiementLabel = modeRaw === "financement" ? "Financement" : "Comptant";

  const concessionNom =
    get("concessionNom") || escapeHtmlTemplate(process.env.CONCESSION_NOM ?? "") || "Concession";

  const signatureVendeurHtml = buildSignatureImg(signatures.signatureVendeurBase64);
  const signatureClientHtml = buildSignatureImg(signatures.signatureClientBase64);

  const replacements: Record<string, string> = {
    concessionNom,
    bonNumero,
    bonDate: today,

    clientNom: get("clientNom"),
    clientPrenom: get("clientPrenom"),
    clientDateNaissance: get("clientDateNaissance"),
    clientNumeroCni: get("clientNumeroCni"),
    clientAdresse: get("clientAdresse"),

    vehiculePrix: formatMoney(prix),

    reprise_plaque: get("reprise_plaque"),
    reprise_marque: get("reprise_marque"),
    reprise_modele: get("reprise_modele"),
    reprise_vin: get("reprise_vin"),
    reprise_premiere_circulation: get("reprise_premiere_circulation"),
    reprise_valeur: formatMoney(repriseValeur),
    reprise_duree_mois: get("reprise_duree_mois"),

    vehiculeRemise: formatMoney(remise),
    netAPayer: formatMoney(netAPayer),
    acompte: formatMoney(acompte),
    solde: formatMoney(solde),
    modePaiementLabel,
    vehiculeDateLivraison: get("vehiculeDateLivraison"),
  };

  html = html.replace(/\{\{vehiculeRowsHtml\}\}/g, vehiculeRowsHtml);
  html = html.replace(/\{\{customFieldsRowsHtml\}\}/g, customFieldsRowsHtml);
  html = html.replace(/\{\{signature_vendeur\}\}/g, signatureVendeurHtml);
  html = html.replace(/\{\{signature_client\}\}/g, signatureClientHtml);

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "—");
  }

  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");

  return html;
}

async function renderPdfFromHtml(html: string): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

type SendPdfEmailBody = {
  pdfBase64?: string;
  clientEmail?: string;
  clientNom?: string;
  clientPrenom?: string;
  vehiculeModele?: string;
  vendeurNom?: string;
  vendeurEmail?: string;
  brouillonId?: string;
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
};

type EmbedSignatureBody = {
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
  pdfBase64?: string;
  signatureBase64?: string;
};

type CompleteSignatureBody = {
  token?: string;
  signatureBase64?: string;
};

type ResendBody = {
  brouillonId?: string;
  token?: string;
};

function parseRequestBody(req: VercelRequest): Record<string, unknown> | null {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function generateToken(): string {
  return crypto.randomUUID();
}

async function handleSendEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const body = data as SendPdfEmailBody;
  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const clientEmail = String(body.clientEmail ?? "").trim();
  const clientNom = String(body.clientNom ?? "").trim();
  const clientPrenom = String(body.clientPrenom ?? "").trim();
  const vehiculeModele = String(body.vehiculeModele ?? "").trim() || "Véhicule";
  const vendeurNom = String(body.vendeurNom ?? "").trim() || "Votre conseiller";
  const vendeurEmail = String(body.vendeurEmail ?? "").trim();
  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const formData =
    body.formData && typeof body.formData === "object" ? body.formData : {};
  const signatureVendeurBase64 = String(body.signatureVendeurBase64 ?? "").trim();

  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 requis" });
  if (!clientEmail || !isValidEmail(clientEmail)) {
    return res.status(400).json({ error: "clientEmail invalide" });
  }

  const userId = await getAuthUserId(req);

  let signatureToken: string | null = null;
  let expiresAtIso: string | null = null;
  try {
    const admin = await getSupabaseAdmin();
    signatureToken = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expiresAtIso = expiresAt.toISOString();

    const { error } = await admin.from("signature_requests").insert({
      token: signatureToken,
      brouillon_id: brouillonId,
      user_id: userId,
      client_email: clientEmail,
      client_nom: clientNom || null,
      client_prenom: clientPrenom || null,
      vendeur_email: vendeurEmail || null,
      vendeur_nom: vendeurNom,
      vehicule_modele: vehiculeModele,
      pdf_base64: pdfBase64,
      form_data: formData,
      signature_vendeur: signatureVendeurBase64 || null,
      expires_at: expiresAtIso,
    });

    if (error) {
      console.error("[actions/send-email] insert signature_requests:", error);
      signatureToken = null;
      expiresAtIso = null;
    }
  } catch (err) {
    console.error("[actions/send-email] supabase admin error:", err);
    signatureToken = null;
    expiresAtIso = null;
  }

  const appUrl = getPublicAppUrl(req);
  const signUrl = signatureToken ? `${appUrl}/signer/${signatureToken}` : null;

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const subject = `Votre bon de commande — ${vehiculeModele}`;
  const greeting = `Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},`.replace(
    /\s+,$/,
    ",",
  );

  const signCta = signUrl
    ? `
    <div style="margin: 22px 0; padding: 18px; background: #eef0f8; border-left: 4px solid #2c3e8f; border-radius: 6px;">
      <p style="margin: 0 0 12px; font-weight: 600; color: #1a1a2e;">
        Signature électronique
      </p>
      <p style="margin: 0 0 14px; color: #444;">
        Pour signer votre bon de commande, cliquez sur le lien ci-dessous :
      </p>
      <p style="margin: 0 0 8px;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #666;">
        Ou copiez-collez ce lien dans votre navigateur :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a><br>
        <span style="color: #888;">Ce lien est valable 7 jours.</span>
      </p>
    </div>`
    : "";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>${greeting}</p>
      <p>Veuillez trouver ci-joint votre bon de commande pour le véhicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.
      </p>
      ${signCta}
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: "bon-de-commande.pdf",
          content: pdfBase64,
        },
      ],
    });

    if (error) {
      return res.status(500).json({ error: error.message || "Echec d'envoi email" });
    }

    return res.status(200).json({
      ok: true,
      signatureRequest: signatureToken
        ? {
            token: signatureToken,
            signUrl,
            expiresAt: expiresAtIso,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }
}

async function handleEmbedSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as EmbedSignatureBody;

  if (body.pdfBase64 && !body.formData) {
    return res.status(400).json({
      error:
        "Contrat obsolète : envoyez `formData` + `signatureVendeurBase64` pour permettre l'incrustation HTML.",
    });
  }

  const formData = body.formData;
  const signatureVendeurBase64 =
    body.signatureVendeurBase64?.trim() || body.signatureBase64?.trim() || "";
  const signatureClientBase64 = body.signatureClientBase64?.trim() || "";

  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }
  if (!signatureVendeurBase64 && !signatureClientBase64) {
    return res
      .status(400)
      .json({ error: "Au moins une signature (vendeur ou client) est requise." });
  }

  try {
    const html = buildHtml(formData, {
      signatureVendeurBase64,
      signatureClientBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Echec de l'incrustation de la signature dans le PDF";
    console.error("[actions/embed-signature] error:", err);
    return res.status(500).json({ error: message });
  }
}

async function handleCompleteSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as CompleteSignatureBody;
  const token = String(body.token ?? "").trim();
  const signatureBase64 = String(body.signatureBase64 ?? "").trim();

  if (!token) return res.status(400).json({ error: "token requis" });
  if (!signatureBase64) {
    return res.status(400).json({ error: "signatureBase64 requis" });
  }

  const admin = await getSupabaseAdmin();
  const { data: request, error: readError } = await admin
    .from("signature_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (readError) {
    console.error("[actions/complete-signature] read error:", readError);
    return res.status(500).json({ error: "Erreur de lecture" });
  }
  if (!request) {
    return res.status(404).json({ error: "Demande de signature introuvable" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Lien de signature expire" });
  }

  let signedPdfBase64: string;
  try {
    const formData =
      request.form_data && typeof request.form_data === "object"
        ? (request.form_data as Record<string, string>)
        : {};
    const html = buildHtml(formData, {
      signatureVendeurBase64: request.signature_vendeur ?? undefined,
      signatureClientBase64: signatureBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    signedPdfBase64 = pdfBuffer.toString("base64");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur lors de la generation du PDF signe";
    console.error("[actions/complete-signature] render error:", err);
    return res.status(500).json({ error: message });
  }

  const signedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("signature_requests")
    .update({
      signature_client: signatureBase64,
      signed_at: signedAt,
      pdf_base64: signedPdfBase64,
    })
    .eq("token", token);

  if (updateError) {
    console.error("[actions/complete-signature] update error:", updateError);
    return res.status(500).json({ error: "Erreur d'enregistrement" });
  }

  if (request.brouillon_id) {
    try {
      const { data: existing } = await admin
        .from("brouillons")
        .select("vehicle_field_values")
        .eq("id", request.brouillon_id)
        .maybeSingle();

      const currentKv =
        existing?.vehicle_field_values && typeof existing.vehicle_field_values === "object"
          ? (existing.vehicle_field_values as Record<string, unknown>)
          : {};

      await admin
        .from("brouillons")
        .update({
          vehicle_field_values: {
            ...currentKv,
            client_signed_at: signedAt,
          },
          updated_at: signedAt,
        })
        .eq("id", request.brouillon_id);
    } catch (err) {
      console.warn("[actions/complete-signature] brouillon update failed:", err);
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[actions/complete-signature] RESEND_API_KEY manquante — emails non envoyés");
    return res.status(200).json({
      ok: true,
      signedAt,
      pdfBase64: signedPdfBase64,
      emails: { client: false, vendeur: false },
    });
  }

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const clientEmail = String(request.client_email ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const vendeurEmail = String(request.vendeur_email ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";
  const fullClientName = `${clientPrenom} ${clientNom}`.trim() || clientEmail;

  const subject = `Bon de commande signe — ${vehiculeModele}`;
  const attachments = [
    {
      filename: "bon-de-commande-signe.pdf",
      content: signedPdfBase64,
    },
  ];

  const clientHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Merci pour votre signature. Vous trouverez en piece jointe votre
        <strong>bon de commande signe</strong> pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Conservez ce document : il fait foi entre vous et la concession.</p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  const vendeurHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour,</p>
      <p>Le client <strong>${escapeHtml(fullClientName)}</strong> a signe
        electroniquement le bon de commande pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Le PDF final, comportant les deux signatures, est joint a cet email.</p>
      <p>— L'equipe AutoDocs</p>
    </div>
  `;

  const emailResults = { client: false, vendeur: false };

  try {
    const { error: clientErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html: clientHtml,
      attachments,
    });
    if (!clientErr) emailResults.client = true;
    else console.error("[actions/complete-signature] email client error:", clientErr);
  } catch (err) {
    console.error("[actions/complete-signature] email client exception:", err);
  }

  if (vendeurEmail) {
    try {
      const { error: vendeurErr } = await resend.emails.send({
        from,
        to: vendeurEmail,
        subject: `Bon signe par ${fullClientName} — ${vehiculeModele}`,
        html: vendeurHtml,
        attachments,
      });
      if (!vendeurErr) emailResults.vendeur = true;
      else console.error("[actions/complete-signature] email vendeur error:", vendeurErr);
    } catch (err) {
      console.error("[actions/complete-signature] email vendeur exception:", err);
    }
  }

  return res.status(200).json({
    ok: true,
    signedAt,
    pdfBase64: signedPdfBase64,
    emails: emailResults,
  });
}

async function handleResendSignatureEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorise" });
  }

  const body = data as ResendBody;
  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const tokenInput = String(body.token ?? "").trim() || null;

  if (!brouillonId && !tokenInput) {
    return res.status(400).json({ error: "brouillonId ou token requis" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const admin = await getSupabaseAdmin();
  const query = admin
    .from("signature_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenInput) query.eq("token", tokenInput);
  else if (brouillonId) query.eq("brouillon_id", brouillonId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[actions/resend-signature-email] read error:", error);
    return res.status(500).json({ error: "Erreur de lecture" });
  }

  const request = rows?.[0];
  if (!request) {
    return res.status(404).json({ error: "Aucune demande de signature trouvee" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }

  let token = String(request.token);
  let expiresAt = request.expires_at;
  const isExpired = expiresAt && new Date(expiresAt).getTime() < Date.now();

  if (isExpired) {
    token = crypto.randomUUID();
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("signature_requests").insert({
      token,
      brouillon_id: request.brouillon_id,
      user_id: userId,
      client_email: request.client_email,
      client_nom: request.client_nom,
      client_prenom: request.client_prenom,
      vendeur_email: request.vendeur_email,
      vendeur_nom: request.vendeur_nom,
      vehicule_modele: request.vehicule_modele,
      pdf_base64: request.pdf_base64,
      form_data: request.form_data,
      signature_vendeur: request.signature_vendeur,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("[actions/resend-signature-email] insert error:", insertError);
      return res.status(500).json({ error: "Impossible de regenerer le lien" });
    }
  }

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const appUrl = getPublicAppUrl(req);
  const signUrl = `${appUrl}/signer/${token}`;

  const clientEmail = String(request.client_email ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Pour rappel, voici le lien permettant de signer votre bon de commande
         pour le vehicule <strong>${escapeHtml(vehiculeModele)}</strong> :</p>
      <p style="margin: 18px 0;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="font-size: 12px; color: #666;">
        Lien valable 7 jours :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a>
      </p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  try {
    const { error: emailErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject: `Rappel : signature du bon de commande — ${vehiculeModele}`,
      html,
      attachments: request.pdf_base64
        ? [{ filename: "bon-de-commande.pdf", content: request.pdf_base64 }]
        : undefined,
    });
    if (emailErr) {
      return res.status(500).json({ error: emailErr.message || "Echec d'envoi email" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }

  return res.status(200).json({
    ok: true,
    token,
    signUrl,
    expiresAt,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = parseRequestBody(req);
  if (parsed === null) {
    return res.status(400).json({ error: "JSON invalide" });
  }

  const { action, ...data } = parsed;
  const actionName = String(action ?? "").trim();

  switch (actionName) {
    case "send-email":
      return handleSendEmail(req, data, res);
    case "embed-signature":
      return handleEmbedSignature(data, res);
    case "complete-signature":
      return handleCompleteSignature(data, res);
    case "resend-signature-email":
      return handleResendSignatureEmail(req, data, res);
    default:
      return res.status(400).json({ error: "Action inconnue" });
  }
}

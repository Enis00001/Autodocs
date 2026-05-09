import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  getAuthUserId,
  getPublicAppUrl,
  getSupabaseAdmin,
} from "./_lib/supabase-admin.js";

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
      emails: { client: false, vendeur: false, concession: false },
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

  const emailResults = { client: false, vendeur: false, concession: false };

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

  // ---------------------------------------------------------------------------
  //  Envoi à la concession (compte AUTH propriétaire du brouillon)
  //
  //  Indépendant de `vendeur_email` (champ texte parfois absent dans la
  //  signature_request). On résout l'email côté serveur via :
  //      brouillon_id → brouillons.user_id → auth.users.email.
  //
  //  Ce bloc est isolé dans son propre try/catch : si l'envoi échoue, on
  //  loggue mais on ne fait pas échouer la requête (la signature est
  //  déjà persistée et le client a déjà été notifié).
  // ---------------------------------------------------------------------------
  try {
    let concessionUserId: string | null = null;

    if (request.brouillon_id) {
      const { data: brouillon, error: brouillonErr } = await admin
        .from("brouillons")
        .select("user_id")
        .eq("id", request.brouillon_id)
        .maybeSingle();
      if (brouillonErr) {
        console.warn(
          "[actions/complete-signature] brouillon read for concession email:",
          brouillonErr,
        );
      } else if (brouillon?.user_id) {
        concessionUserId = brouillon.user_id as string;
      }
    }

    // Fallback : signature_requests.user_id (rempli au moment du send-email).
    if (!concessionUserId && request.user_id) {
      concessionUserId = request.user_id as string;
    }

    if (!concessionUserId) {
      console.warn(
        "[actions/complete-signature] aucun user_id concession trouvé — email concession ignoré",
      );
    } else {
      const { data: userData, error: userErr } =
        await admin.auth.admin.getUserById(concessionUserId);
      const concessionEmail = String(userData?.user?.email ?? "").trim();

      if (userErr) {
        console.warn(
          "[actions/complete-signature] auth.admin.getUserById:",
          userErr.message,
        );
      } else if (!concessionEmail) {
        console.warn(
          "[actions/complete-signature] email concession introuvable pour user_id:",
          concessionUserId,
        );
      } else if (
        emailResults.vendeur &&
        vendeurEmail.toLowerCase() === concessionEmail.toLowerCase()
      ) {
        // Doublon : déjà envoyé via vendeurEmail (même adresse). On considère
        // l'email concession comme "envoyé" et on persiste le timestamp.
        emailResults.concession = true;
        try {
          await admin
            .from("signature_requests")
            .update({ email_concession_sent_at: new Date().toISOString() })
            .eq("token", token);
        } catch (markErr) {
          console.warn(
            "[actions/complete-signature] update email_concession_sent_at (dedup):",
            markErr,
          );
        }
      } else {
        const concessionSubject = `✅ Bon de commande signé — ${fullClientName || "Client"}`;
        const signedDateLabel = new Date(signedAt).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const concessionHtml = `
          <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
            <p>Bonjour,</p>
            <p>Le client <strong>${escapeHtml(fullClientName)}</strong> vient de signer
              électroniquement le bon de commande pour le véhicule
              <strong>${escapeHtml(vehiculeModele)}</strong>
              le <strong>${escapeHtml(signedDateLabel)}</strong>.</p>
            <p>Vous trouverez en pièce jointe le <strong>PDF final</strong> comportant
              les deux signatures (vendeur + client). Conservez ce document : il fait
              foi entre votre concession et le client.</p>
            <p>— L'équipe AutoDocs</p>
          </div>
        `;

        const { error: concessionErr } = await resend.emails.send({
          from,
          to: concessionEmail,
          subject: concessionSubject,
          html: concessionHtml,
          attachments,
        });

        if (concessionErr) {
          console.error(
            "[actions/complete-signature] email concession error:",
            concessionErr,
          );
        } else {
          emailResults.concession = true;
          try {
            await admin
              .from("signature_requests")
              .update({ email_concession_sent_at: new Date().toISOString() })
              .eq("token", token);
          } catch (markErr) {
            console.warn(
              "[actions/complete-signature] update email_concession_sent_at:",
              markErr,
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[actions/complete-signature] email concession exception:", err);
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

/* ==================================================================
 *  CERFA 15776*01 — Remplissage du PDF officiel via pdf-lib
 *
 *  Le PDF de référence (`public/templates/cerfa_15776-01.pdf`) est un
 *  AcroForm 2 pages publié par la République française : Page1 et
 *  Page2 portent les mêmes champs (114 au total). On remplit les deux
 *  pages avec les mêmes valeurs puis `flatten()` pour figer le rendu.
 *
 *  Mapping radios / cases (option PDF "1" = première option, "2" = seconde) :
 *    radio1 = Présence du certificat d'immatriculation : OUI=1 / NON=2
 *    radio2 = Vendeur : Personne physique=1 / morale=2
 *    radio3 = Vendeur : Sexe M=1 / F=2 (pertinent si physique)
 *    radio4 = Vendeur : « céder »=1 / « céder pour destruction »=2
 *    radio5 = Acheteur : Personne physique=1 / morale=2
 *    radio6 = Acheteur : Sexe M=1 / F=2
 *    ckb_ValidationDéclaration1/2/3  = certifications vendeur (3 cases)
 *    ckb_ValidationDéclarationA1/A2  = certifications acheteur (2 cases)
 *
 *  Vercel : le fichier est inclus dans le bundle de la fonction grâce
 *  à `vercel.json` → `functions["api/actions.ts"].includeFiles`.
 * ================================================================== */

type CerfaInput = Record<string, unknown>;

const TYPES_VOIE_RE =
  /^(rue|avenue|av\.?|bd\.?|boulevard|impasse|chemin|route|place|all[ée]e|cours|quai|chauss[ée]e|square|zone|zac|za|villa|passage|sentier|esplanade|hameau|lieu-dit|cit[ée])\b/i;

function pickStr(o: CerfaInput, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v.trim() : "";
}
function pickBool(o: CerfaInput, key: string): boolean {
  const v = o[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * Découpe une adresse libre en (numéro, extension, type de voie, nom).
 * Si le pattern ne matche pas, l'intégralité va dans `nomVoie` — le
 * formulaire reste correct (la voie complète apparaît).
 */
function parseAdresse(raw: string): {
  numero: string;
  extension: string;
  typeVoie: string;
  nomVoie: string;
} {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return { numero: "", extension: "", typeVoie: "", nomVoie: "" };
  const m = /^(\d+)\s*(?:(bis|ter|quater)\s+)?(.+)$/i.exec(trimmed);
  if (!m) return { numero: "", extension: "", typeVoie: "", nomVoie: trimmed };
  const numero = m[1];
  const extension = (m[2] ?? "").toLowerCase();
  const reste = m[3];
  const typeMatch = TYPES_VOIE_RE.exec(reste);
  if (!typeMatch) {
    return { numero, extension, typeVoie: "", nomVoie: reste };
  }
  const typeVoie = typeMatch[1];
  const nomVoie = reste.slice(typeMatch[0].length).trim();
  return { numero, extension, typeVoie, nomVoie };
}

/**
 * Découpe une date "DD/MM/YYYY" (ou "YYYY-MM-DD") en (jour, mois, année).
 */
function parseDate(raw: string): { j: string; m: string; a: string } {
  const s = raw.trim();
  if (!s) return { j: "", m: "", a: "" };
  const slash = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
  if (slash) {
    const j = slash[1].padStart(2, "0");
    const m = slash[2].padStart(2, "0");
    const aRaw = slash[3];
    const a = aRaw.length === 2 ? `20${aRaw}` : aRaw;
    return { j, m, a };
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    return {
      j: iso[3].padStart(2, "0"),
      m: iso[2].padStart(2, "0"),
      a: iso[1],
    };
  }
  return { j: "", m: "", a: "" };
}

/**
 * Découpe une heure (H, HH, "HH:MM", "HHhMM") en (HH, MM).
 */
function parseHeure(raw: string): { hh: string; mm: string } {
  const s = raw.trim();
  if (!s) return { hh: "", mm: "" };
  const both = /^(\d{1,2})[h:.](\d{1,2})$/i.exec(s);
  if (both) {
    return { hh: both[1].padStart(2, "0"), mm: both[2].padStart(2, "0") };
  }
  const justH = /^(\d{1,2})$/.exec(s);
  if (justH) return { hh: justH[1].padStart(2, "0"), mm: "00" };
  return { hh: "", mm: "" };
}

function loadCerfaTemplate(): Buffer {
  // Le bundle Vercel inclut public/templates/** via vercel.json.
  const filePath = path.join(
    process.cwd(),
    "public",
    "templates",
    "cerfa_15776-01.pdf",
  );
  return readFileSync(filePath);
}

async function handleFillCerfa(
  req: VercelRequest,
  data: CerfaInput,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const cerfaInput =
    data.cerfa_data && typeof data.cerfa_data === "object"
      ? (data.cerfa_data as CerfaInput)
      : (data as CerfaInput);

  // ---------- Données véhicule ----------
  const immat = pickStr(cerfaInput, "immatriculation");
  const vin = pickStr(cerfaInput, "vin");
  const dateMec = parseDate(pickStr(cerfaInput, "date_mise_en_circulation"));
  const marque = pickStr(cerfaInput, "marque");
  const typeVariante = pickStr(cerfaInput, "type_variante");
  const genre = pickStr(cerfaInput, "genre");
  const denomination = pickStr(cerfaInput, "denomination");
  const kilometrage = pickStr(cerfaInput, "kilometrage");
  const numeroFormule = pickStr(cerfaInput, "numero_formule");
  const dateCi = parseDate(pickStr(cerfaInput, "date_ci_ancien_format"));
  const motifAbsenceCi = pickStr(cerfaInput, "motif_absence_ci");

  // ---------- Vendeur (concession) ----------
  const vendeurType =
    pickStr(cerfaInput, "vendeur_type").toLowerCase() === "physique"
      ? "physique"
      : "morale";
  const vendeurNom = pickStr(cerfaInput, "vendeur_nom");
  const vendeurSiren = pickStr(cerfaInput, "vendeur_siren").replace(/\s+/g, "");
  const vendeurAdresse = parseAdresse(pickStr(cerfaInput, "vendeur_adresse"));
  const vendeurCp = pickStr(cerfaInput, "vendeur_code_postal");
  const vendeurVille = pickStr(cerfaInput, "vendeur_ville");
  const cessionDate = parseDate(pickStr(cerfaInput, "cession_date"));
  const cessionHeure = parseHeure(pickStr(cerfaInput, "cession_heure"));
  const cessionLieu = pickStr(cerfaInput, "cession_lieu");
  const certifSituation = pickBool(cerfaInput, "certif_situation_admin");
  const certifNonTransfo = pickBool(cerfaInput, "certif_pas_transformation");
  const certifVhu = pickBool(cerfaInput, "certif_vhu");
  const vendeurAgrement = pickStr(cerfaInput, "vendeur_agrement_vhu");
  const cession = pickStr(cerfaInput, "cession_motif").toLowerCase(); // "" | "destruction"

  // ---------- Acheteur ----------
  const acheteurType =
    pickStr(cerfaInput, "acheteur_type").toLowerCase() === "morale"
      ? "morale"
      : "physique";
  const acheteurSexe = pickStr(cerfaInput, "acheteur_sexe").toUpperCase(); // "M" | "F"
  const acheteurNom = pickStr(cerfaInput, "acheteur_nom");
  const acheteurPrenom = pickStr(cerfaInput, "acheteur_prenom");
  const acheteurSiret =
    pickStr(cerfaInput, "acheteur_siret").replace(/\s+/g, "");
  const acheteurDateNaiss = parseDate(
    pickStr(cerfaInput, "acheteur_date_naissance"),
  );
  const acheteurLieuNaiss = pickStr(cerfaInput, "acheteur_lieu_naissance");
  const acheteurAdresse = parseAdresse(pickStr(cerfaInput, "acheteur_adresse"));
  const acheteurCp = pickStr(cerfaInput, "acheteur_code_postal");
  const acheteurVille = pickStr(cerfaInput, "acheteur_ville");

  // Validation minimale
  if (!immat || !acheteurNom || !acheteurAdresse.nomVoie) {
    return res.status(400).json({
      error:
        "Champs requis manquants : immatriculation, nom acheteur, adresse acheteur.",
    });
  }

  // ---------- Chargement du PDF officiel ----------
  let pdfBytes: Buffer;
  try {
    pdfBytes = loadCerfaTemplate();
  } catch (err) {
    console.error("[fill-cerfa] template not found:", err);
    return res.status(500).json({
      error:
        "Modèle CERFA introuvable côté serveur (public/templates/cerfa_15776-01.pdf).",
    });
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    console.error("[fill-cerfa] PDFDocument.load:", err);
    return res.status(500).json({ error: "PDF officiel illisible." });
  }
  const form = doc.getForm();

  // Helpers tolérants : maxLength, champ inconnu, etc.
  const safeSetText = (name: string, value: string) => {
    try {
      const f = form.getTextField(name);
      const max = f.getMaxLength();
      const v = max !== undefined ? value.slice(0, max) : value;
      f.setText(v);
    } catch (err) {
      console.warn("[fill-cerfa] setText", name, err);
    }
  };
  const safeCheck = (name: string, on: boolean) => {
    try {
      const f = form.getCheckBox(name);
      if (on) f.check();
      else f.uncheck();
    } catch (err) {
      console.warn("[fill-cerfa] check", name, err);
    }
  };
  const safeRadio = (name: string, option: string | null) => {
    if (!option) return;
    try {
      form.getRadioGroup(name).select(option);
    } catch (err) {
      console.warn("[fill-cerfa] radio", name, err);
    }
  };

  // On remplit les deux pages identiquement.
  const PAGES = ["Page1", "Page2"] as const;

  for (const PG of PAGES) {
    const p = `topmostSubform[0].${PG}[0]`;

    // ---- Véhicule ----
    safeSetText(`${p}.num_Immatriculation[0]`, immat);
    safeSetText(`${p}.num_Identification[0]`, vin);
    safeSetText(`${p}.num_DateImmatriculationJour[0]`, dateMec.j);
    safeSetText(`${p}.num_DateImmatriculationMois[0]`, dateMec.m);
    safeSetText(`${p}.num_DateImmatriculationAnnée[0]`, dateMec.a);
    safeSetText(`${p}.txt_MarqueVéhicule[0]`, marque);
    safeSetText(`${p}.txt_TypeVarianteVersionVéhicule[0]`, typeVariante);
    safeSetText(`${p}.txt_GenreNational[0]`, genre);
    safeSetText(`${p}.txt_DénominationCommerciale[0]`, denomination);
    safeSetText(`${p}.num_KilométrageCompteur[0]`, kilometrage);

    // Présence du certificat d'immatriculation : OUI si numero_formule fourni.
    const certificatPresent = numeroFormule.length > 0;
    safeRadio(`${p}.Groupe_de_boutons_radio1[0]`, certificatPresent ? "1" : "2");
    safeSetText(`${p}.num_Formule[0]`, numeroFormule);
    safeSetText(`${p}.txt_MotifAbscenceCertificat[0]`, motifAbsenceCi);
    safeSetText(`${p}.num_DateCertificatJour[0]`, dateCi.j);
    safeSetText(`${p}.num_DateCertificatMois[0]`, dateCi.m);
    safeSetText(`${p}.num_DateCertificatAnnée[0]`, dateCi.a);

    // ---- Vendeur ----
    safeRadio(
      `${p}.Groupe_de_boutons_radio2[0]`,
      vendeurType === "physique" ? "1" : "2",
    );
    // Sexe vendeur seulement si personne physique
    if (vendeurType === "physique") {
      const sexeVendeur = pickStr(cerfaInput, "vendeur_sexe").toUpperCase();
      safeRadio(
        `${p}.Groupe_de_boutons_radio3[0]`,
        sexeVendeur === "M" ? "1" : sexeVendeur === "F" ? "2" : null,
      );
    }
    safeSetText(`${p}.txt_IdentitéVendeur[0]`, vendeurNom);
    safeSetText(`${p}.Num_Siret[0]`, vendeurSiren);
    safeSetText(`${p}.num_VoieAdresse[0]`, vendeurAdresse.numero);
    safeSetText(`${p}.txt_ExtensionAdresse[0]`, vendeurAdresse.extension);
    safeSetText(`${p}.txt_TypeVoieAdresse[0]`, vendeurAdresse.typeVoie);
    safeSetText(`${p}.txt_NomVoie[0]`, vendeurAdresse.nomVoie);
    safeSetText(`${p}.num_CodePostalAdresse[0]`, vendeurCp);
    safeSetText(`${p}.txt_CommuneAdresse[0]`, vendeurVille);

    // « céder » vs « céder pour destruction »
    safeRadio(
      `${p}.Groupe_de_boutons_radio4[0]`,
      cession === "destruction" ? "2" : "1",
    );
    safeSetText(`${p}.num_DateVenteJour[0]`, cessionDate.j);
    safeSetText(`${p}.num_DateVenteMois[0]`, cessionDate.m);
    safeSetText(`${p}.num_DateVenteAnnée[0]`, cessionDate.a);
    safeSetText(`${p}.num_HoraireVente1[0]`, cessionHeure.hh);
    safeSetText(`${p}.num_HoraireVente2[0]`, cessionHeure.mm);
    safeSetText(`${p}.num_Agrément[0]`, vendeurAgrement);
    safeSetText(`${p}.txt_LieuDéclaration1[0]`, cessionLieu);
    safeSetText(`${p}.num_DateDéclaration[0]`, pickStr(cerfaInput, "cession_date"));

    // 3 certifications vendeur
    safeCheck(`${p}.ckb_ValidationDéclaration1[0]`, certifSituation);
    safeCheck(`${p}.ckb_ValidationDéclaration2[0]`, certifNonTransfo);
    safeCheck(`${p}.ckb_ValidationDéclaration3[0]`, certifVhu);

    // ---- Acheteur ----
    safeRadio(
      `${p}.Groupe_de_boutons_radio5[0]`,
      acheteurType === "morale" ? "2" : "1",
    );
    if (acheteurType === "physique") {
      safeRadio(
        `${p}.Groupe_de_boutons_radio6[0]`,
        acheteurSexe === "M" ? "1" : acheteurSexe === "F" ? "2" : null,
      );
    }
    const acheteurFullName =
      [acheteurNom, acheteurPrenom].filter(Boolean).join(" ").trim();
    safeSetText(`${p}.txt_IdentitéAcheteur[0]`, acheteurFullName);
    safeSetText(`${p}.num_SiretAcheteur[0]`, acheteurSiret);
    safeSetText(
      `${p}.txt_LieuNaissanceAcheteur[0]`,
      acheteurLieuNaiss,
    );
    safeSetText(`${p}.num_DateNaissanceAcheteurJ[0]`, acheteurDateNaiss.j);
    safeSetText(`${p}.num_DateNaissanceAcheteurM[0]`, acheteurDateNaiss.m);
    safeSetText(`${p}.num_DateNaissanceAcheteurA[0]`, acheteurDateNaiss.a);
    safeSetText(`${p}.num_VoieAdresseAcheteur[0]`, acheteurAdresse.numero);
    safeSetText(
      `${p}.txt_ExtensionAdresseAcheteur[0]`,
      acheteurAdresse.extension,
    );
    safeSetText(
      `${p}.txt_TypeVoieAdresseAcheteur[0]`,
      acheteurAdresse.typeVoie,
    );
    safeSetText(`${p}.txt_NomVoieAdresseAcheteur[0]`, acheteurAdresse.nomVoie);
    safeSetText(`${p}.num_CodePostalAdresseAcheteur[0]`, acheteurCp);
    safeSetText(`${p}.txt_CommuneAdresseAcheteur[0]`, acheteurVille);
    safeSetText(`${p}.txt_LieuDéclaration2[0]`, cessionLieu);
    safeSetText(`${p}.txt_dateDéclaration[0]`, pickStr(cerfaInput, "cession_date"));

    // 2 certifications acheteur — cochées par défaut (l'acheteur « acquiert »
    // et « est informé »), peuvent être explicitement décochées via input.
    const certAcquerir = cerfaInput.acheteur_cert_acquerir === false ? false : true;
    const certInforme = cerfaInput.acheteur_cert_informe === false ? false : true;
    safeCheck(`${p}.ckb_ValidationDéclarationA1[0]`, certAcquerir);
    safeCheck(`${p}.ckb_ValidationDéclarationA2[0]`, certInforme);

    // Opposition à la prospection commerciale (par défaut non cochée)
    safeCheck(
      `${p}.ckb_OppositionUtilisationDonnée[0]`,
      pickBool(cerfaInput, "opposition_prospection"),
    );
  }

  // Fige les valeurs pour qu'elles s'affichent partout (impressions, viewers
  // mobiles, etc.). flatten() supprime aussi tout reste de XFA.
  try {
    form.flatten();
  } catch (err) {
    console.warn("[fill-cerfa] flatten:", err);
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save();
  } catch (err) {
    console.error("[fill-cerfa] save:", err);
    return res.status(500).json({ error: "Échec de la génération du PDF." });
  }

  return res.status(200).json({
    pdf_base64: Buffer.from(outBytes).toString("base64"),
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
    case "fill-cerfa":
      return handleFillCerfa(req, data, res);
    default:
      return res.status(400).json({ error: "Action inconnue" });
  }
}

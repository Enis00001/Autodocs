import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const QUOTA_GRATUIT = 10;

/**
 * Vérifie le JWT Supabase passé dans l'en-tête Authorization.
 * Renvoie l'user id si valide, null sinon. Inliné (pas d'import local) pour
 * éviter les soucis de bundling Vercel.
 */
async function requireAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}

/**
 * Vérifie le quota gratuit à vie et incrémente `bons_total` côté serveur.
 * Renvoie `{ ok: true }` si autorisé, sinon `{ ok: false, error }` avec
 * le code HTTP à renvoyer.
 */
async function checkAndConsumeQuota(
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return {
      ok: false,
      status: 500,
      body: { error: "Configuration Supabase incomplète côté serveur." },
    };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: existing } = await admin
    .from("abonnements")
    .select("plan, bons_total")
    .eq("user_id", userId)
    .maybeSingle();

  const plan = (existing?.plan as string) || "gratuit";
  const bonsTotal = (existing?.bons_total as number) ?? 0;

  if (plan !== "pro" && bonsTotal >= QUOTA_GRATUIT) {
    return {
      ok: false,
      status: 429,
      body: {
        error: "Limite atteinte — passez au Pro pour des bons illimités.",
        code: "quota_reached",
        plan,
        bonsTotal,
        quota: QUOTA_GRATUIT,
      },
    };
  }

  const nextCount = bonsTotal + 1;
  if (!existing) {
    await admin.from("abonnements").insert({
      user_id: userId,
      plan: "gratuit",
      bons_total: nextCount,
    });
  } else {
    await admin
      .from("abonnements")
      .update({ bons_total: nextCount, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  return { ok: true };
}

/* ================================================================== */
/*  HTML template (inliné pour éviter les problèmes de FS sur Vercel)  */
/* ================================================================== */

function getHtmlTemplate(): string {
  return `<!DOCTYPE html>
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
  .sig-box .sig-line { border-bottom: 1px dotted #999; height: 46px; }
  .sig-box .sig-date { font-size: 9px; color: #888; margin-top: 6px; }
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
    <div class="sig-box">
      <div class="sig-title">L'acheteur</div>
      <div class="sig-name">{{clientPrenom}} {{clientNom}}</div>
      <div style="font-size: 9px; color: #666; margin-bottom: 6px;">Lu et approuvé, bon pour accord</div>
      <div class="sig-line"></div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
    <div class="sig-box">
      <div class="sig-title">Le vendeur</div>
      <div class="sig-name">{{concessionNom}}</div>
      <div style="font-size: 9px; color: #666; margin-bottom: 6px;">Cachet & signature</div>
      <div class="sig-line"></div>
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
}

/* ================================================================== */
/*  Helpers                                                            */
/* ================================================================== */

function escapeHtml(s: string): string {
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

/**
 * Parse une valeur pouvant être un JSON stringifié ou directement la structure.
 * Accepte object/array et retourne la valeur JS correspondante, ou null.
 */
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

/* ================================================================== */
/*  Build HTML                                                         */
/* ================================================================== */

/**
 * Construit les `<tr>` de la section "Véhicule vendu" à partir du couple
 * (stock_donnees, stock_colonnes). On respecte l'ordre de `stock_colonnes`
 * et on skippe les valeurs vides pour éviter les lignes fantômes.
 */
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
      `<tr><th>${escapeHtml(key)}</th><td colspan="3">${escapeHtml(value)}</td></tr>`,
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
      `<tr><th>${escapeHtml(sectionLabel[section] ?? section)} — ${escapeHtml(label)}</th><td colspan="3">${escapeHtml(v)}</td></tr>`,
    );
  }
  return rows.join("\n");
}

function buildHtml(formData: Record<string, string>): string {
  let html = getHtmlTemplate();

  const get = (key: string) => escapeHtml((formData[key] ?? "").trim());

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero = `BC-${Date.now().toString(36).toUpperCase()}`;

  const prix = parseNum(formData.vehiculePrix);
  const remise = parseNum(formData.vehiculeRemise);
  const repriseValeur = parseNum(formData.reprise_valeur);
  const repriseActive = repriseValeur > 0;
  const netAPayer = Math.max(0, prix - remise - repriseValeur);
  const acompte = parseNum(formData.acompte);
  const solde = Math.max(0, netAPayer - acompte);

  const repriseDureeMoisRaw = (formData.reprise_duree_mois ?? "").trim();
  const hasRepriseDuree = repriseDureeMoisRaw !== "" && parseNum(repriseDureeMoisRaw) > 0;

  // Sections conditionnelles
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

  /* ---------- Tableau véhicule dynamique ---------- */
  const donnees = parseStringDict(formData.stock_donnees);
  const colonnes = parseStringArray(formData.stock_colonnes);
  const vehiculeRowsHtml = buildVehiculeRowsHtml(donnees, colonnes);
  const customDefs =
    parseJsonMaybe<Array<Record<string, unknown>>>(formData.custom_fields_defs) ?? [];
  const customValues = parseStringDict(formData.custom_fields_values);
  const customFieldsRowsHtml = buildCustomFieldsRowsHtml(customDefs, customValues);

  // Si aucune ligne véhicule n'a de valeur, on masque toute la section.
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

  // Libellé mode paiement
  const modeRaw = (formData.modePaiement ?? "").trim().toLowerCase();
  const modePaiementLabel = modeRaw === "financement" ? "Financement" : "Comptant";

  const concessionNom =
    get("concessionNom") || escapeHtml(process.env.CONCESSION_NOM ?? "") || "Concession";

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

  // Cas spécial : `vehiculeRowsHtml` contient du HTML déjà échappé, il ne doit
  // PAS passer par le remplacement générique qui traite les valeurs comme du
  // texte brut et ajoute des "—" sur les vides.
  html = html.replace(/\{\{vehiculeRowsHtml\}\}/g, vehiculeRowsHtml);
  html = html.replace(/\{\{customFieldsRowsHtml\}\}/g, customFieldsRowsHtml);

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "—");
  }

  // Remplace tout placeholder restant par "—"
  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");

  return html;
}

/* ================================================================== */
/*  Main handler                                                       */
/* ================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await requireAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  const quota = await checkAndConsumeQuota(userId);
  if (!quota.ok) {
    return res.status(quota.status).json(quota.body);
  }

  let body: Record<string, unknown>;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: "JSON invalide" });
    }
  } else {
    body = req.body ?? {};
  }

  const formData = (body.formData ?? body) as Record<string, string>;
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }

  const html = buildHtml(formData);

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

    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-pdf] Error:", message);
    return res.status(500).json({ error: message || "Erreur lors de la génération du PDF" });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

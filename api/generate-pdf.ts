import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

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
        <th>Date de naissance</th><td>{{clientDateNaissance}}</td>
        <th>N° pièce d'identité</th><td>{{clientNumeroCni}}</td>
      </tr>
      <tr>
        <th>Adresse</th><td colspan="3">{{clientAdresse}}</td>
      </tr>
    </table>
  </div>

  <!--VEHICULE_SECTION_START-->
  <div class="section">
    <div class="section-title">Véhicule vendu</div>
    <table>
      <!--VEH_MODELE_ROW_START-->
      <tr><th>Modèle / Désignation</th><td colspan="3">{{vehiculeModele}}</td></tr>
      <!--VEH_MODELE_ROW_END-->
      <!--VEH_VIN_ROW_START-->
      <tr><th>N° VIN / Châssis</th><td colspan="3">{{vehiculeVin}}</td></tr>
      <!--VEH_VIN_ROW_END-->
      <!--VEH_ANNEE_ROW_START-->
      <tr><th>Année</th><td colspan="3">{{vehiculeAnnee}}</td></tr>
      <!--VEH_ANNEE_ROW_END-->
      <!--VEH_PREMIERE_CIRCULATION_ROW_START-->
      <tr><th>1ère mise en circulation</th><td colspan="3">{{vehiculePremiereCirculation}}</td></tr>
      <!--VEH_PREMIERE_CIRCULATION_ROW_END-->
      <!--VEH_KILOMETRAGE_ROW_START-->
      <tr><th>Kilométrage</th><td colspan="3">{{vehiculeKilometrage}}</td></tr>
      <!--VEH_KILOMETRAGE_ROW_END-->
      <!--VEH_COULEUR_ROW_START-->
      <tr><th>Couleur</th><td colspan="3">{{vehiculeCouleur}}</td></tr>
      <!--VEH_COULEUR_ROW_END-->
      <!--VEH_PUISSANCE_ROW_START-->
      <tr><th>Puissance (CV)</th><td colspan="3">{{vehiculeChevaux}}</td></tr>
      <!--VEH_PUISSANCE_ROW_END-->
      <!--VEH_CO2_ROW_START-->
      <tr><th>CO2 (g/km)</th><td colspan="3">{{vehiculeCo2}}</td></tr>
      <!--VEH_CO2_ROW_END-->
      <!--VEH_CARBURANT_ROW_START-->
      <tr><th>Carburant</th><td colspan="3">{{vehiculeCarburant}}</td></tr>
      <!--VEH_CARBURANT_ROW_END-->
      <!--VEH_TRANSMISSION_ROW_START-->
      <tr><th>Transmission</th><td colspan="3">{{vehiculeTransmission}}</td></tr>
      <!--VEH_TRANSMISSION_ROW_END-->
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

/* ================================================================== */
/*  Build HTML                                                         */
/* ================================================================== */

/**
 * Liste des champs véhicule configurables et la paire de markers associée.
 * "modele" regroupe marque/modele/version (ils sont concaténés dans
 * `vehiculeModele`). Le PDF n'a pas de ligne dédiée par composant.
 */
const VEHICULE_ROW_MARKERS: Record<string, [string, string]> = {
  modele: ["<!--VEH_MODELE_ROW_START-->", "<!--VEH_MODELE_ROW_END-->"],
  marque: ["<!--VEH_MODELE_ROW_START-->", "<!--VEH_MODELE_ROW_END-->"],
  version: ["<!--VEH_MODELE_ROW_START-->", "<!--VEH_MODELE_ROW_END-->"],
  vin: ["<!--VEH_VIN_ROW_START-->", "<!--VEH_VIN_ROW_END-->"],
  annee: ["<!--VEH_ANNEE_ROW_START-->", "<!--VEH_ANNEE_ROW_END-->"],
  premiere_circulation: [
    "<!--VEH_PREMIERE_CIRCULATION_ROW_START-->",
    "<!--VEH_PREMIERE_CIRCULATION_ROW_END-->",
  ],
  kilometrage: ["<!--VEH_KILOMETRAGE_ROW_START-->", "<!--VEH_KILOMETRAGE_ROW_END-->"],
  couleur: ["<!--VEH_COULEUR_ROW_START-->", "<!--VEH_COULEUR_ROW_END-->"],
  puissance: ["<!--VEH_PUISSANCE_ROW_START-->", "<!--VEH_PUISSANCE_ROW_END-->"],
  co2: ["<!--VEH_CO2_ROW_START-->", "<!--VEH_CO2_ROW_END-->"],
  carburant: ["<!--VEH_CARBURANT_ROW_START-->", "<!--VEH_CARBURANT_ROW_END-->"],
  transmission: ["<!--VEH_TRANSMISSION_ROW_START-->", "<!--VEH_TRANSMISSION_ROW_END-->"],
};

/** Champs véhicule affichés par défaut si `colonnes_pdf` n'est pas fourni. */
const DEFAULT_VEHICULE_FIELDS = [
  "modele",
  "vin",
  "premiere_circulation",
  "kilometrage",
  "couleur",
  "puissance",
  "co2",
];

function parseColonnesPdf(raw: unknown): string[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const arr = raw.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return arr.length > 0 ? arr : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const arr = parsed.filter((x): x is string => typeof x === "string" && x.trim() !== "");
        return arr.length > 0 ? arr : null;
      }
    } catch {
      /* fallthrough */
    }
    const arr = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length > 0 ? arr : null;
  }
  return null;
}

function buildHtml(formData: Record<string, string>): string {
  let html = getHtmlTemplate();

  const get = (key: string) => escapeHtml((formData[key] ?? "").trim());

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero = `BC-${Date.now().toString(36).toUpperCase()}`;

  // Montants
  const prix = parseNum(formData.vehiculePrix);
  const remise = parseNum(formData.vehiculeRemise);
  // La reprise n'est prise en compte que si l'utilisateur a saisi une valeur > 0.
  // C'est le seul critère d'affichage pour l'utilisateur final : pas besoin de
  // s'appuyer sur un toggle séparé dans le PDF.
  const repriseValeur = parseNum(formData.reprise_valeur);
  const repriseActive = repriseValeur > 0;
  const netAPayer = Math.max(0, prix - remise - repriseValeur);
  const acompte = parseNum(formData.acompte);
  const solde = Math.max(0, netAPayer - acompte);

  // Sections conditionnelles
  if (repriseActive) {
    html = keepBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = keepBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
  } else {
    html = stripBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = stripBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
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

  /* ---------- Lignes "Véhicule vendu" conditionnelles selon colonnes_pdf ---------- */
  const colonnesPdf = parseColonnesPdf(formData.colonnes_pdf);
  const visibleFields = new Set(colonnesPdf ?? DEFAULT_VEHICULE_FIELDS);
  let anyVehRow = false;
  for (const [field, [startM, endM]] of Object.entries(VEHICULE_ROW_MARKERS)) {
    const isVisible = visibleFields.has(field);
    // On doit toujours faire une passe (keep ou strip) car keep retire les markers
    // même quand ils apparaissent en double (plusieurs fields partagent modele).
    if (isVisible) {
      html = keepBlock(html, startM, endM);
      anyVehRow = true;
    } else {
      html = stripBlock(html, startM, endM);
    }
  }
  // Si aucune ligne véhicule visible, on cache toute la section.
  if (anyVehRow) {
    html = keepBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  }

  // Libellé mode paiement
  const modeRaw = (formData.modePaiement ?? "").trim().toLowerCase();
  const modePaiementLabel = modeRaw === "financement" ? "Financement" : "Comptant";

  // Concession : fallback sur env/placeholder
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

    vehiculeModele: get("vehiculeModele"),
    vehiculeVin: get("vehiculeVin"),
    vehiculePremiereCirculation: get("vehiculePremiereCirculation"),
    vehiculeKilometrage: get("vehiculeKilometrage"),
    vehiculeCouleur: get("vehiculeCouleur"),
    vehiculeChevaux: get("vehiculeChevaux"),
    vehiculeCo2: get("vehiculeCo2"),
    vehiculeAnnee: get("vehiculeAnnee"),
    vehiculeCarburant: get("vehiculeCarburant"),
    vehiculeTransmission: get("vehiculeTransmission"),
    vehiculePrix: formatMoney(prix),

    reprise_plaque: get("reprise_plaque"),
    reprise_marque: get("reprise_marque"),
    reprise_modele: get("reprise_modele"),
    reprise_vin: get("reprise_vin"),
    reprise_premiere_circulation: get("reprise_premiere_circulation"),
    reprise_valeur: formatMoney(repriseValeur),

    vehiculeRemise: formatMoney(remise),
    netAPayer: formatMoney(netAPayer),
    acompte: formatMoney(acompte),
    solde: formatMoney(solde),
    modePaiementLabel,
    vehiculeDateLivraison: get("vehiculeDateLivraison"),
  };

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

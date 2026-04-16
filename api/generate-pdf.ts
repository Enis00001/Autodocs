import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/* ================================================================== */
/*  HTML template (inlined to avoid filesystem issues on Vercel)       */
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
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2c3e8f; padding-bottom: 14px; margin-bottom: 16px; }
  .header-left h1 { font-size: 20px; font-weight: 800; color: #2c3e8f; letter-spacing: -0.3px; }
  .header-left p { font-size: 10px; color: #666; margin-top: 2px; }
  .header-right { text-align: right; font-size: 10px; color: #555; }
  .header-right .ref { font-size: 13px; font-weight: 700; color: #2c3e8f; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #fff; background: #2c3e8f; padding: 5px 10px; margin-bottom: 0; }
  table { width: 100%; border-collapse: collapse; }
  table td, table th { padding: 5px 8px; border: 1px solid #d0d4e4; font-size: 10.5px; vertical-align: top; }
  table th { background: #eef0f8; font-weight: 600; color: #333; text-align: left; width: 34%; white-space: nowrap; }
  table td { color: #1a1a2e; }
  .two-col { display: flex; gap: 12px; }
  .two-col > .col { flex: 1; }
  .summary-row { display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11px; }
  .summary-row.total { font-weight: 800; font-size: 13px; background: #eef0f8; border: 2px solid #2c3e8f; margin-top: 2px; }
  .summary-row .label { color: #444; }
  .summary-row .value { font-weight: 600; color: #1a1a2e; }
  .signatures { display: flex; gap: 20px; margin-top: 18px; }
  .sig-box { flex: 1; border: 1px solid #d0d4e4; padding: 10px; min-height: 80px; }
  .sig-box .sig-title { font-size: 10px; font-weight: 700; color: #2c3e8f; margin-bottom: 4px; }
  .sig-box .sig-line { border-bottom: 1px dotted #999; height: 40px; }
  .sig-box .sig-date { font-size: 9px; color: #888; margin-top: 6px; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d0d4e4; font-size: 8.5px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <h1>BON DE COMMANDE</h1>
      <p>Véhicule d'occasion / neuf</p>
    </div>
    <div class="header-right">
      <div class="ref">N° {{bonNumero}}</div>
      <div>Date : {{bonDate}}</div>
      <div>Vendeur : {{vendeurNom}}</div>
    </div>
  </div>

  <div class="two-col">
    <div class="col">
      <div class="section">
        <div class="section-title">Acheteur</div>
        <table>
          <tr><th>Nom</th><td>{{clientNom}}</td></tr>
          <tr><th>Prénom</th><td>{{clientPrenom}}</td></tr>
          <tr><th>Date de naissance</th><td>{{clientDateNaissance}}</td></tr>
          <tr><th>N° CNI</th><td>{{clientNumeroCni}}</td></tr>
          <tr><th>Adresse</th><td>{{clientAdresse}}</td></tr>
          <tr><th>Téléphone</th><td>{{clientTelephone}}</td></tr>
          <tr><th>E-mail</th><td>{{clientEmail}}</td></tr>
        </table>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <div class="section-title">Véhicule</div>
        <table>
          <tr><th>Modèle</th><td>{{vehiculeModele}}</td></tr>
          <tr><th>N° VIN / Châssis</th><td>{{vehiculeVin}}</td></tr>
          <tr><th>Immatriculation</th><td>{{vehiculeCarteGrise}}</td></tr>
          <tr><th>1ère mise en circulation</th><td>{{vehiculePremiereCirculation}}</td></tr>
          <tr><th>Kilométrage</th><td>{{vehiculeKilometrage}}</td></tr>
          <tr><th>Couleur</th><td>{{vehiculeCouleur}}</td></tr>
          <tr><th>Puissance (CV)</th><td>{{vehiculeChevaux}}</td></tr>
          <tr><th>CO2 (g/km)</th><td>{{vehiculeCo2}}</td></tr>
        </table>
      </div>
    </div>
  </div>

  {{customVehicleFieldsHtml}}

  <div class="section">
    <div class="section-title">Tarification</div>
    <div style="border: 1px solid #d0d4e4; padding: 8px;">
      <div class="summary-row"><span class="label">Prix de vente TTC</span><span class="value">{{vehiculePrix}} €</span></div>
      <div class="summary-row"><span class="label">Options</span><span class="value">{{optionsPrixTotal}} €</span></div>
      <div class="summary-row"><span class="label">Frais de reprise</span><span class="value">{{vehiculeFraisReprise}} €</span></div>
      <div class="summary-row"><span class="label">Remise accordée</span><span class="value">- {{vehiculeRemise}} €</span></div>
      <div class="summary-row"><span class="label">Reprise ancien véhicule</span><span class="value">- {{vehiculeReprise}} €</span></div>
      <div class="summary-row total"><span class="label">TOTAL À PAYER TTC</span><span class="value">{{totalFinal}} €</span></div>
    </div>
  </div>

  <div class="two-col">
    <div class="col">
      <div class="section">
        <div class="section-title">Financement</div>
        <table>
          <tr><th>Type</th><td>{{vehiculeFinancement}}</td></tr>
          <tr><th>Apport</th><td>{{apport}} €</td></tr>
          <tr><th>Organisme</th><td>{{organismePreteur}}</td></tr>
          <tr><th>Montant crédit</th><td>{{montantCredit}} €</td></tr>
          <tr><th>Taux</th><td>{{tauxCredit}} %</td></tr>
          <tr><th>Durée</th><td>{{dureeMois}} mois</td></tr>
          <tr><th>Clause suspensive</th><td>{{clauseSuspensive}}</td></tr>
        </table>
      </div>
    </div>
    <div class="col">
      <div class="section">
        <div class="section-title">Règlement</div>
        <table>
          <tr><th>Acompte</th><td>{{acompte}} €</td></tr>
          <tr><th>Mode de paiement</th><td>{{modePaiement}}</td></tr>
          <tr><th>Livraison prévue</th><td>{{vehiculeDateLivraison}}</td></tr>
        </table>
      </div>
      <div class="section">
        <div class="section-title">RIB</div>
        <table>
          <tr><th>Titulaire</th><td>{{ribTitulaire}}</td></tr>
          <tr><th>IBAN</th><td>{{ribIban}}</td></tr>
          <tr><th>BIC</th><td>{{ribBic}}</td></tr>
          <tr><th>Banque</th><td>{{ribBanque}}</td></tr>
        </table>
      </div>
    </div>
  </div>

  {{vendeurNotesHtml}}

  <div class="signatures">
    <div class="sig-box">
      <div class="sig-title">L'acheteur (lu et approuvé, bon pour accord)</div>
      <div style="font-size: 10px; margin-bottom: 4px;">{{clientPrenom}} {{clientNom}}</div>
      <div class="sig-line"></div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
    <div class="sig-box">
      <div class="sig-title">Le vendeur</div>
      <div style="font-size: 10px; margin-bottom: 4px;">{{vendeurNom}}</div>
      <div class="sig-line"></div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
  </div>

  <div class="footer">
    Ce bon de commande constitue un engagement ferme et définitif des deux parties, sous réserve des conditions suspensives mentionnées ci-dessus.
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
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(s: string): string {
  const n = parseNum(s);
  if (n === 0 && !s.trim()) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STANDARD_KEYS = new Set([
  "clientNom", "clientPrenom", "clientDateNaissance", "clientNumeroCni",
  "clientAdresse", "clientEmail", "clientTelephone",
  "ribTitulaire", "ribIban", "ribBic", "ribBanque",
  "vehiculeModele", "vehiculeVin", "vehiculePremiereCirculation",
  "vehiculeKilometrage", "vehiculeCo2", "vehiculeChevaux",
  "vehiculePrix", "vehiculeCouleur", "vehiculeOptions",
  "vehiculeCarteGrise", "vehiculeFraisReprise", "vehiculeRemise",
  "vehiculeFinancement", "vehiculeDateLivraison", "vehiculeReprise",
  "acompte", "modePaiement", "apport", "organismePreteur",
  "montantCredit", "tauxCredit", "dureeMois", "clauseSuspensive",
  "vendeurNom", "vendeurNotes", "optionsMode", "optionsPrixTotal",
  "optionsDetailJson", "templateId",
]);

function buildHtml(formData: Record<string, string>): string {
  let html = getHtmlTemplate();

  const get = (key: string) => escapeHtml(formData[key]?.trim() ?? "");
  const getMoney = (key: string) => formatMoney(formData[key] ?? "");

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero = `BC-${Date.now().toString(36).toUpperCase()}`;

  const prix = parseNum(formData.vehiculePrix ?? "");
  const options = parseNum(formData.optionsPrixTotal ?? "");
  const frais = parseNum(formData.vehiculeFraisReprise ?? "");
  const remise = parseNum(formData.vehiculeRemise ?? "");
  const reprise = parseNum(formData.vehiculeReprise ?? "");
  const totalFinal = Math.max(0, prix + options + frais - remise - reprise);

  const replacements: Record<string, string> = {
    bonNumero,
    bonDate: today,
    clientNom: get("clientNom"),
    clientPrenom: get("clientPrenom"),
    clientDateNaissance: get("clientDateNaissance"),
    clientNumeroCni: get("clientNumeroCni"),
    clientAdresse: get("clientAdresse"),
    clientTelephone: get("clientTelephone"),
    clientEmail: get("clientEmail"),
    vehiculeModele: get("vehiculeModele"),
    vehiculeVin: get("vehiculeVin"),
    vehiculeCarteGrise: get("vehiculeCarteGrise"),
    vehiculePremiereCirculation: get("vehiculePremiereCirculation"),
    vehiculeKilometrage: get("vehiculeKilometrage"),
    vehiculeCouleur: get("vehiculeCouleur"),
    vehiculeChevaux: get("vehiculeChevaux"),
    vehiculeCo2: get("vehiculeCo2"),
    vehiculePrix: getMoney("vehiculePrix"),
    optionsPrixTotal: getMoney("optionsPrixTotal"),
    vehiculeFraisReprise: getMoney("vehiculeFraisReprise"),
    vehiculeRemise: getMoney("vehiculeRemise"),
    vehiculeReprise: getMoney("vehiculeReprise"),
    totalFinal: totalFinal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    vehiculeFinancement: get("vehiculeFinancement"),
    apport: getMoney("apport"),
    organismePreteur: get("organismePreteur"),
    montantCredit: getMoney("montantCredit"),
    tauxCredit: get("tauxCredit"),
    dureeMois: get("dureeMois"),
    clauseSuspensive: formData.clauseSuspensive === "oui" ? "Oui (14 jours)" : "Non",
    acompte: getMoney("acompte"),
    modePaiement: get("modePaiement"),
    vehiculeDateLivraison: get("vehiculeDateLivraison"),
    ribTitulaire: get("ribTitulaire"),
    ribIban: get("ribIban"),
    ribBic: get("ribBic"),
    ribBanque: get("ribBanque"),
    vendeurNom: get("vendeurNom"),
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "—");
  }

  const customEntries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(formData)) {
    if (STANDARD_KEYS.has(key)) continue;
    const val = (value ?? "").trim();
    if (!val) continue;
    const label = key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    customEntries.push([label, escapeHtml(val)]);
  }

  if (customEntries.length > 0) {
    const rows = customEntries
      .map(([label, val]) => `<tr><th>${label}</th><td>${val}</td></tr>`)
      .join("");
    html = html.replace(
      "{{customVehicleFieldsHtml}}",
      `<div class="section"><div class="section-title">Informations complémentaires</div><table>${rows}</table></div>`,
    );
  } else {
    html = html.replace("{{customVehicleFieldsHtml}}", "");
  }

  const notes = (formData.vendeurNotes ?? "").trim();
  if (notes) {
    html = html.replace(
      "{{vendeurNotesHtml}}",
      `<div class="section"><div class="section-title">Observations</div><div style="border:1px solid #d0d4e4;padding:8px;font-size:10.5px;">${escapeHtml(notes)}</div></div>`,
    );
  } else {
    html = html.replace("{{vendeurNotesHtml}}", "");
  }

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
    try { body = JSON.parse(req.body); } catch { return res.status(400).json({ error: "JSON invalide" }); }
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
  } catch (err: any) {
    console.error("[generate-pdf] Error:", err?.message, err?.stack);
    return res.status(500).json({
      error: err?.message ?? "Erreur lors de la génération du PDF",
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

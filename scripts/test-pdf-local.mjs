/**
 * Test local du pipeline PDF V1 — duplique la logique de api/generate-pdf.ts
 * (sans @sparticuz/chromium, réservé à Vercel). Utilise Chrome local.
 *
 * Usage :
 *   node scripts/test-pdf-local.mjs            # reprise ON + acompte + remise
 *   node scripts/test-pdf-local.mjs --minimal  # cas minimal (reprise OFF)
 *
 * Sortie : test-output/bon-de-commande-{test,minimal}.pdf
 */

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p;
  throw new Error("Chrome introuvable — installe Google Chrome.");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function parseNum(s) {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function stripBlock(html, start, end) {
  return html.replace(new RegExp(`${start}[\\s\\S]*?${end}`, "g"), "");
}
function keepBlock(html, start, end) {
  return html.replace(new RegExp(start, "g"), "").replace(new RegExp(end, "g"), "");
}

const VEHICULE_ROW_MARKERS = {
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

const DEFAULT_VEHICULE_FIELDS = [
  "modele",
  "vin",
  "premiere_circulation",
  "kilometrage",
  "couleur",
  "puissance",
  "co2",
];

function parseColonnesPdf(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const arr = raw.filter((x) => typeof x === "string" && x.trim());
    return arr.length ? arr : null;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      const p = JSON.parse(t);
      if (Array.isArray(p)) {
        const arr = p.filter((x) => typeof x === "string" && x.trim());
        return arr.length ? arr : null;
      }
    } catch { /* ignore */ }
    const arr = t.split(",").map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  }
  return null;
}

function buildHtml(formData) {
  const template = fs.readFileSync(
    path.join(process.cwd(), "src/templates/bon-de-commande.html"),
    "utf-8",
  );
  let html = template;

  const get = (k) => escapeHtml((formData[k] ?? "").trim());
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

  const colonnesPdf = parseColonnesPdf(formData.colonnes_pdf);
  const visibleFields = new Set(colonnesPdf ?? DEFAULT_VEHICULE_FIELDS);
  let anyVehRow = false;
  for (const [field, [s, e]] of Object.entries(VEHICULE_ROW_MARKERS)) {
    if (visibleFields.has(field)) {
      html = keepBlock(html, s, e);
      anyVehRow = true;
    } else {
      html = stripBlock(html, s, e);
    }
  }
  if (anyVehRow) {
    html = keepBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  }

  const modeRaw = (formData.modePaiement ?? "").trim().toLowerCase();
  const modePaiementLabel = modeRaw === "financement" ? "Financement" : "Comptant";

  const repl = {
    concessionNom: get("concessionNom") || "Auto Prestige Lyon",
    bonNumero, bonDate: today,
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

  for (const [k, v] of Object.entries(repl)) {
    html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || "—");
  }
  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");
  return html;
}

const FULL = {
  concessionNom: "Auto Prestige Lyon",
  clientNom: "DURAND",
  clientPrenom: "Marie",
  clientDateNaissance: "14/03/1988",
  clientNumeroCni: "123456789012",
  clientAdresse: "12 rue des Lilas, 75015 Paris",
  vehiculeModele: "Peugeot 3008 Allure BlueHDi 130",
  vehiculeVin: "VF3LBYHZRKS123456",
  vehiculePremiereCirculation: "15/06/2021",
  vehiculeKilometrage: "48 500",
  vehiculeCo2: "118",
  vehiculeChevaux: "8",
  vehiculePrix: "22990",
  vehiculeCouleur: "Gris platinium",
  vehiculeAnnee: "2021",
  vehiculeCarburant: "Diesel",
  vehiculeTransmission: "BVM 6",
  // Exemple de filtrage : seuls ces champs apparaîtront dans la section véhicule.
  colonnes_pdf: '["modele","vin","annee","kilometrage","couleur","carburant"]',
  reprise_plaque: "AB-123-CD",
  reprise_marque: "Renault",
  reprise_modele: "Clio IV Estate",
  reprise_vin: "VF1R9800865432101",
  reprise_premiere_circulation: "21/07/2016",
  reprise_valeur: "3500",
  modePaiement: "financement",
  acompte: "2000",
  vehiculeRemise: "500",
  vehiculeDateLivraison: "30/04/2026",
};

const MINIMAL = {
  concessionNom: "Garage du Centre",
  clientNom: "PETIT",
  clientPrenom: "Louis",
  clientDateNaissance: "02/09/1995",
  clientNumeroCni: "987654321000",
  clientAdresse: "5 impasse du Moulin, 69100 Villeurbanne",
  vehiculeModele: "Renault Clio V TCe 90",
  vehiculeVin: "VF1RJA00167890123",
  vehiculePremiereCirculation: "01/2023",
  vehiculeKilometrage: "22 000",
  vehiculeCo2: "114",
  vehiculeChevaux: "5",
  vehiculePrix: "14500",
  vehiculeCouleur: "Rouge flamme",
  repriseActive: "non",
  modePaiement: "comptant",
  acompte: "",
  vehiculeRemise: "",
  vehiculeDateLivraison: "15/05/2026",
};

(async () => {
  const isMinimal = process.argv.includes("--minimal");
  const data = isMinimal ? MINIMAL : FULL;
  const suffix = isMinimal ? "minimal" : "test";

  const outDir = path.join(process.cwd(), "test-output");
  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml(data);
  const htmlPath = path.join(outDir, `bon-de-commande-${suffix}.html`);
  fs.writeFileSync(htmlPath, html, "utf-8");
  console.log(`[1/2] HTML : ${htmlPath}`);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfPath = path.join(outDir, `bon-de-commande-${suffix}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });
    console.log(`[2/2] PDF  : ${pdfPath} (${(fs.statSync(pdfPath).size / 1024).toFixed(1)} Ko)`);
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error("Erreur :", err); process.exit(1); });

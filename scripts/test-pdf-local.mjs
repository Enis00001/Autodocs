/**
 * Test local du pipeline PDF V2 — duplique la logique de api/generate-pdf.ts
 * (sans @sparticuz/chromium, réservé à Vercel). Utilise Chrome local.
 *
 * V2 : la section "Véhicule vendu" est générée dynamiquement à partir de
 *      `stock_donnees` + `stock_colonnes` envoyés par le front (JSON
 *      stringifiés).
 *
 * Usage :
 *   node scripts/test-pdf-local.mjs            # cas complet (reprise + acompte)
 *   node scripts/test-pdf-local.mjs --minimal  # cas minimal (sans reprise)
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

function parseJsonMaybe(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function parseStringArray(raw) {
  const v = parseJsonMaybe(raw);
  const src = Array.isArray(v) ? v : Array.isArray(raw) ? raw : [];
  return src.filter((x) => typeof x === "string" && x.trim());
}

function parseStringDict(raw) {
  const v = parseJsonMaybe(raw);
  const src =
    v && typeof v === "object" && !Array.isArray(v)
      ? v
      : raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : null;
  if (!src) return {};
  const out = {};
  for (const [k, val] of Object.entries(src)) {
    if (!k) continue;
    if (val === null || val === undefined) continue;
    out[k] = String(val);
  }
  return out;
}

function buildVehiculeRowsHtml(donnees, colonnes) {
  const rows = [];
  const order = colonnes.length > 0 ? colonnes : Object.keys(donnees);
  for (const key of order) {
    const v = donnees[key];
    if (v === undefined || v === null) continue;
    const trimmed = String(v).trim();
    if (!trimmed) continue;
    rows.push(
      `<tr><th>${escapeHtml(key)}</th><td colspan="3">${escapeHtml(trimmed)}</td></tr>`,
    );
  }
  return rows.join("\n");
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

  const donnees = parseStringDict(formData.stock_donnees);
  const colonnes = parseStringArray(formData.stock_colonnes);
  const vehiculeRowsHtml = buildVehiculeRowsHtml(donnees, colonnes);

  if (vehiculeRowsHtml.trim().length > 0) {
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

  // Injection du HTML déjà échappé — bypass le remplacement générique
  html = html.replace(/\{\{vehiculeRowsHtml\}\}/g, vehiculeRowsHtml);

  for (const [k, v] of Object.entries(repl)) {
    html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || "—");
  }
  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");
  return html;
}

/* -- Fixtures ------------------------------------------------------------- */

// Cas réaliste : colonnes issues d'un fichier Excel quelconque. Les clés
// peuvent être exotiques : c'est tout l'intérêt de la V2.
const FULL = {
  concessionNom: "Auto Prestige Lyon",
  clientNom: "DURAND",
  clientPrenom: "Marie",
  clientDateNaissance: "14/03/1988",
  clientNumeroCni: "123456789012",
  clientAdresse: "12 rue des Lilas, 75015 Paris",
  stock_donnees: JSON.stringify({
    "Marque": "Peugeot",
    "Modèle": "3008 Allure BlueHDi 130",
    "VIN": "VF3LBYHZRKS123456",
    "1ère immat.": "15/06/2021",
    "Kilométrage": "48 500 km",
    "Couleur": "Gris platinium",
    "Puissance fiscale": "8 CV",
    "Carburant": "Diesel",
    "Notes internes": "Ne pas afficher au client",
  }),
  stock_colonnes: JSON.stringify([
    "Marque",
    "Modèle",
    "VIN",
    "1ère immat.",
    "Kilométrage",
    "Couleur",
    "Carburant",
    // "Puissance fiscale" et "Notes internes" sont absents → pas dans le PDF.
  ]),
  vehiculePrix: "22990",
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
  stock_donnees: JSON.stringify({
    "Désignation": "Renault Clio V TCe 90",
    "Prix": "14 500",
  }),
  stock_colonnes: JSON.stringify(["Désignation", "Prix"]),
  vehiculePrix: "14500",
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

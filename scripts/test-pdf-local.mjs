/**
 * Test local de la génération PDF — n'utilise PAS @sparticuz/chromium
 * (réservé à Vercel Lambda). Utilise Chrome installé localement.
 *
 * Usage : node scripts/test-pdf-local.mjs
 * Sortie : test-output/bon-de-commande-test.pdf
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
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome introuvable — installe Google Chrome.");
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseNum(s) {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(s) {
  const n = parseNum(s);
  if (n === 0 && !String(s).trim()) return "—";
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function buildHtml(formData) {
  const template = fs.readFileSync(
    path.join(process.cwd(), "src/templates/bon-de-commande.html"),
    "utf-8",
  );
  let html = template
    .replace(/\{\{#if [^}]+\}\}/g, "")
    .replace(/\{\{\/if\}\}/g, "");

  const get = (k) => escapeHtml((formData[k] ?? "").trim());
  const getMoney = (k) => formatMoney(formData[k] ?? "");

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero = `BC-${Date.now().toString(36).toUpperCase()}`;

  const prix = parseNum(formData.vehiculePrix);
  const options = parseNum(formData.optionsPrixTotal);
  const frais = parseNum(formData.vehiculeFraisReprise);
  const remise = parseNum(formData.vehiculeRemise);
  const reprise = parseNum(formData.vehiculeReprise);
  const totalFinal = Math.max(0, prix + options + frais - remise - reprise);

  const repl = {
    bonNumero, bonDate: today,
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
    vehiculeCarteGriseMontant: getMoney("vehiculeCarteGriseMontant"),
    vehiculeFraisReprise: getMoney("vehiculeFraisReprise"),
    vehiculeRemise: getMoney("vehiculeRemise"),
    vehiculeReprise: getMoney("vehiculeReprise"),
    totalFinal: totalFinal.toLocaleString("fr-FR", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }),
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
    vendeurNotes: get("vendeurNotes"),
  };

  for (const [k, v] of Object.entries(repl)) {
    html = html.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v || "—");
  }

  const custom = [];
  for (const [k, v] of Object.entries(formData)) {
    if (STANDARD_KEYS.has(k)) continue;
    const val = (v ?? "").trim();
    if (!val) continue;
    const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    custom.push(`<tr><th>${label}</th><td>${escapeHtml(val)}</td></tr>`);
  }
  html = html.replace(
    "{{customVehicleFieldsHtml}}",
    custom.length > 0 ? custom.join("") : "",
  );

  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");
  return html;
}

const SAMPLE = {
  clientNom: "DURAND",
  clientPrenom: "Marie",
  clientDateNaissance: "14/03/1988",
  clientNumeroCni: "123456789012",
  clientAdresse: "12 rue des Lilas, 75015 Paris",
  clientEmail: "marie.durand@example.fr",
  clientTelephone: "06 12 34 56 78",
  ribTitulaire: "Marie Durand",
  ribIban: "FR76 3000 4000 0300 1234 5678 901",
  ribBic: "BNPAFRPPXXX",
  ribBanque: "BNP Paribas",
  vehiculeModele: "Peugeot 3008 Allure BlueHDi 130",
  vehiculeVin: "VF3LBYHZRKS123456",
  vehiculePremiereCirculation: "15/06/2021",
  vehiculeKilometrage: "48 500",
  vehiculeCo2: "118",
  vehiculeChevaux: "8",
  vehiculePrix: "22990",
  vehiculeCouleur: "Gris platinium",
  vehiculeFinancement: "Crédit classique",
  vehiculeDateLivraison: "30/04/2026",
  vehiculeReprise: "3500",
  vehiculeOptions: "GPS, Toit panoramique",
  optionsPrixTotal: "890",
  acompte: "2000",
  modePaiement: "Virement",
  apport: "3000",
  organismePreteur: "Cetelem",
  montantCredit: "17990",
  tauxCredit: "4.9",
  dureeMois: "48",
  clauseSuspensive: "oui",
  vendeurNom: "Jean Lefebvre",
};

(async () => {
  const outDir = path.join(process.cwd(), "test-output");
  fs.mkdirSync(outDir, { recursive: true });

  const html = buildHtml(SAMPLE);
  const htmlPath = path.join(outDir, "bon-de-commande-test.html");
  fs.writeFileSync(htmlPath, html, "utf-8");
  console.log(`[1/2] HTML écrit : ${htmlPath}`);

  const chromePath = findChrome();
  console.log(`      Chrome : ${chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfPath = path.join(outDir, "bon-de-commande-test.pdf");
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });
    console.log(`[2/2] PDF généré : ${pdfPath}`);
    const size = fs.statSync(pdfPath).size;
    console.log(`      Taille : ${(size / 1024).toFixed(1)} Ko`);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});

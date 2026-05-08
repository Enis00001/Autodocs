import type { VercelRequest, VercelResponse } from "@vercel/node";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/* ==================================================================
 *  Bon-template inliné (ex api/_lib/bon-template.ts)
 *  Inliné dans ce fichier pour éviter les soucis de résolution ESM
 *  côté Vercel serverless (ERR_MODULE_NOT_FOUND sur _lib/*).
 * ================================================================== */

const QUOTA_GRATUIT = 10;

/* ==================================================================
 *  CERFA 15776*01 — Déclaration de cession d'un véhicule
 *
 *  Template HTML inliné (source de vérité humaine :
 *  `src/templates/cerfa-cession.html`). Toute modification ici DOIT
 *  être répliquée dans ce fichier source.
 *
 *  Placeholders attendus dans `formData` côté front (cf.
 *  `src/utils/generateCERFA.ts`) :
 *    NOM_VENDEUR, ADRESSE_VENDEUR, SIREN_VENDEUR,
 *    NOM_ACHETEUR, PRENOM_ACHETEUR, ADRESSE_ACHETEUR,
 *    DATE_NAISSANCE_ACHETEUR,
 *    MARQUE_VEHICULE, MODELE_VEHICULE, IMMATRICULATION, VIN,
 *    PREMIERE_CIRCULATION, KILOMETRAGE,
 *    DATE_CESSION, HEURE_CESSION, LIEU_CESSION,
 *    ETAT_VENDU_EN_LETAT ("x" si coché), ETAT_AVEC_CT ("x" si coché)
 *  Plus, pour la signature : `signatureVendeurBase64` injecté en
 *  `{{signature_vendeur}}` (vide = zone à signer à la main).
 * ================================================================== */

const CERFA_TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 10.5px; color: #111; line-height: 1.45; }
  .page { width: 100%; }
  .cerfa-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .cerfa-header .republique { font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; color: #444; }
  .cerfa-header .doc-title { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
  .cerfa-header .doc-subtitle { font-size: 10px; color: #444; margin-top: 2px; }
  .cerfa-header .cerfa-num { text-align: right; border: 1.5px solid #000; padding: 4px 8px; font-weight: 700; font-size: 11px; white-space: nowrap; }
  .cerfa-header .cerfa-num small { display: block; font-size: 8.5px; font-weight: 500; color: #555; margin-top: 1px; }
  .section { margin-bottom: 10px; border: 1px solid #000; }
  .section-title { background: #000; color: #fff; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; padding: 4px 8px; }
  .section-body { padding: 8px 10px; }
  .field-row { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 6px; }
  .field-row:last-child { margin-bottom: 0; }
  .field { flex: 1 1 45%; min-width: 200px; display: flex; flex-direction: column; gap: 1px; }
  .field.full { flex: 1 1 100%; }
  .field.short { flex: 0 1 30%; min-width: 140px; }
  .field-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; color: #555; font-weight: 600; }
  .field-value { border-bottom: 1px solid #555; padding: 2px 2px 3px 2px; min-height: 16px; font-size: 11px; color: #111; font-weight: 500; }
  .checkbox-row { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 6px; }
  .checkbox-item { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
  .checkbox-box { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #000; text-align: center; line-height: 9px; font-weight: 800; font-size: 12px; }
  .signatures { display: flex; gap: 14px; margin-top: 12px; }
  .sig-box { flex: 1; border: 1px solid #000; padding: 8px 10px; min-height: 110px; display: flex; flex-direction: column; }
  .sig-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
  .sig-mention { font-size: 9.5px; color: #444; margin-bottom: 4px; }
  .sig-zone { flex: 1; border: 1px dashed #999; margin-top: 6px; display: flex; align-items: center; justify-content: center; min-height: 70px; }
  .sig-zone img { max-width: 200px; max-height: 80px; display: block; }
  .sig-zone.empty { color: #999; font-size: 9px; font-style: italic; }
  .footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 8px; color: #777; text-align: center; line-height: 1.3; }
  .legal { margin-top: 8px; font-size: 9px; color: #444; line-height: 1.4; border: 1px dashed #888; padding: 6px 8px; background: #fafafa; }
  .legal strong { color: #111; }
</style>
</head>
<body>
<div class="page">
  <div class="cerfa-header">
    <div>
      <div class="republique">République Française</div>
      <div class="doc-title">Déclaration de cession d'un véhicule</div>
      <div class="doc-subtitle">À remettre par l'ancien titulaire à l'acquéreur</div>
    </div>
    <div class="cerfa-num">N° 15776*01<small>Cerfa</small></div>
  </div>

  <div class="section">
    <div class="section-title">1 — Ancien titulaire (vendeur)</div>
    <div class="section-body">
      <div class="field-row"><div class="field full"><span class="field-label">Nom / Raison sociale</span><span class="field-value">{{NOM_VENDEUR}}</span></div></div>
      <div class="field-row"><div class="field full"><span class="field-label">Adresse</span><span class="field-value">{{ADRESSE_VENDEUR}}</span></div></div>
      <div class="field-row"><div class="field"><span class="field-label">N° SIREN (si professionnel)</span><span class="field-value">{{SIREN_VENDEUR}}</span></div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">2 — Nouveau titulaire (acheteur)</div>
    <div class="section-body">
      <div class="field-row">
        <div class="field"><span class="field-label">Nom de famille</span><span class="field-value">{{NOM_ACHETEUR}}</span></div>
        <div class="field"><span class="field-label">Prénom(s)</span><span class="field-value">{{PRENOM_ACHETEUR}}</span></div>
      </div>
      <div class="field-row"><div class="field"><span class="field-label">Date de naissance</span><span class="field-value">{{DATE_NAISSANCE_ACHETEUR}}</span></div></div>
      <div class="field-row"><div class="field full"><span class="field-label">Adresse</span><span class="field-value">{{ADRESSE_ACHETEUR}}</span></div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">3 — Véhicule</div>
    <div class="section-body">
      <div class="field-row">
        <div class="field"><span class="field-label">Marque</span><span class="field-value">{{MARQUE_VEHICULE}}</span></div>
        <div class="field"><span class="field-label">Modèle / Type</span><span class="field-value">{{MODELE_VEHICULE}}</span></div>
      </div>
      <div class="field-row">
        <div class="field"><span class="field-label">N° d'immatriculation</span><span class="field-value">{{IMMATRICULATION}}</span></div>
        <div class="field"><span class="field-label">N° d'identification (VIN)</span><span class="field-value">{{VIN}}</span></div>
      </div>
      <div class="field-row">
        <div class="field"><span class="field-label">Date de 1ère mise en circulation</span><span class="field-value">{{PREMIERE_CIRCULATION}}</span></div>
        <div class="field"><span class="field-label">Kilométrage au compteur</span><span class="field-value">{{KILOMETRAGE}}</span></div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">4 — Cession du véhicule</div>
    <div class="section-body">
      <div class="field-row">
        <div class="field"><span class="field-label">Date de cession</span><span class="field-value">{{DATE_CESSION}}</span></div>
        <div class="field short"><span class="field-label">Heure</span><span class="field-value">{{HEURE_CESSION}}</span></div>
        <div class="field"><span class="field-label">Lieu</span><span class="field-value">{{LIEU_CESSION}}</span></div>
      </div>
      <div class="checkbox-row">
        <div class="checkbox-item"><span class="checkbox-box">{{ETAT_VENDU_EN_LETAT}}</span>Véhicule vendu en l'état (pour pièces détachées ou destruction)</div>
        <div class="checkbox-item"><span class="checkbox-box">{{ETAT_AVEC_CT}}</span>Véhicule vendu avec contrôle technique en cours de validité</div>
      </div>
    </div>
  </div>

  <div class="signatures">
    <div class="sig-box">
      <div class="sig-title">Signature de l'ancien titulaire (vendeur)</div>
      <div class="sig-mention">Précédée de la mention « Vendu en l'état le {{DATE_CESSION}} ».</div>
      <div class="sig-zone">{{signature_vendeur}}</div>
    </div>
    <div class="sig-box">
      <div class="sig-title">Signature du nouveau titulaire (acheteur)</div>
      <div class="sig-mention">Précédée de la mention « Lu et approuvé le {{DATE_CESSION}} ».</div>
      <div class="sig-zone empty">À signer à la main</div>
    </div>
  </div>

  <div class="legal">
    <strong>Démarche en ligne :</strong> l'ancien titulaire dispose de 15 jours à compter de la cession pour déclarer la vente sur
    <strong>histovec.interieur.gouv.fr</strong> ou <strong>ants.gouv.fr</strong>.
    Un exemplaire de cette déclaration doit être remis à l'acquéreur, qui dispose à son tour d'un délai d'un mois pour effectuer la demande de nouvelle carte grise à son nom.
  </div>

  <div class="footer">Document généré par AutoDocs — Conforme à la trame du formulaire Cerfa 15776*01 (Déclaration de cession d'un véhicule).</div>
</div>
</body>
</html>`;

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

  const get = (key: string) => escapeHtml((formData[key] ?? "").trim());

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
    get("concessionNom") || escapeHtml(process.env.CONCESSION_NOM ?? "") || "Concession";

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

/**
 * Construit le HTML CERFA 15776*01 à partir du `formData` envoyé par le
 * front (cf. `src/utils/generateCERFA.ts`). Tous les placeholders attendus
 * sont remplis ; les champs vides apparaissent comme tirets « — » pour
 * matérialiser visuellement les zones non renseignées (à compléter à la
 * main si besoin).
 */
function buildCerfaHtml(
  formData: Record<string, string>,
  signatures: SignatureImages = {},
): string {
  let html = CERFA_TEMPLATE_HTML;

  const get = (key: string) => escapeHtml((formData[key] ?? "").trim());

  // Cases à cocher : on accepte plusieurs représentations vraies.
  const truthyCheckbox = (raw: string): boolean => {
    const v = String(raw ?? "").trim().toLowerCase();
    return ["x", "1", "true", "oui", "yes", "on"].includes(v);
  };
  const checkbox = (key: string) =>
    truthyCheckbox(formData[key] ?? "") ? "X" : "";

  const signatureVendeurHtml = buildSignatureImg(signatures.signatureVendeurBase64);
  html = html.replace(/\{\{signature_vendeur\}\}/g, signatureVendeurHtml);

  const placeholders: Record<string, string> = {
    NOM_VENDEUR: get("NOM_VENDEUR"),
    ADRESSE_VENDEUR: get("ADRESSE_VENDEUR"),
    SIREN_VENDEUR: get("SIREN_VENDEUR"),
    NOM_ACHETEUR: get("NOM_ACHETEUR"),
    PRENOM_ACHETEUR: get("PRENOM_ACHETEUR"),
    ADRESSE_ACHETEUR: get("ADRESSE_ACHETEUR"),
    DATE_NAISSANCE_ACHETEUR: get("DATE_NAISSANCE_ACHETEUR"),
    MARQUE_VEHICULE: get("MARQUE_VEHICULE"),
    MODELE_VEHICULE: get("MODELE_VEHICULE"),
    IMMATRICULATION: get("IMMATRICULATION"),
    VIN: get("VIN"),
    PREMIERE_CIRCULATION: get("PREMIERE_CIRCULATION"),
    KILOMETRAGE: get("KILOMETRAGE"),
    DATE_CESSION: get("DATE_CESSION"),
    HEURE_CESSION: get("HEURE_CESSION"),
    LIEU_CESSION: get("LIEU_CESSION"),
    ETAT_VENDU_EN_LETAT: checkbox("ETAT_VENDU_EN_LETAT"),
    ETAT_AVEC_CT: checkbox("ETAT_AVEC_CT"),
  };

  for (const [key, value] of Object.entries(placeholders)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "—");
  }

  // Tout placeholder restant (sécurité) → tiret.
  html = html.replace(/\{\{[A-Za-z0-9_]+\}\}/g, "—");

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

/* ==================================================================
 *  Auth + quota
 * ================================================================== */

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

/* ==================================================================
 *  Main handler
 * ================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userId = await requireAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorisé" });
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

  const documentType =
    typeof body.documentType === "string" ? body.documentType.toLowerCase().trim() : "bon";
  const isCerfa = documentType === "cerfa";

  const shouldBypassQuota =
    process.env.NODE_ENV === "development" ||
    process.env.BYPASS_QUOTA === "true" ||
    // Le CERFA de cession est un document annexe à un bon de commande déjà
    // comptabilisé : il ne consomme pas de crédit supplémentaire.
    isCerfa;

  if (!shouldBypassQuota) {
    const quota = await checkAndConsumeQuota(userId);
    if (!quota.ok) {
      return res.status(quota.status).json(quota.body);
    }
  }

  const formData = (body.formData ?? body) as Record<string, string>;
  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }

  try {
    let html: string;
    if (isCerfa) {
      const sigVendeur =
        typeof body.signatureVendeurBase64 === "string"
          ? body.signatureVendeurBase64
          : undefined;
      html = buildCerfaHtml(formData, { signatureVendeurBase64: sigVendeur });
    } else {
      html = buildHtml(formData);
    }
    const pdfBuffer = await renderPdfFromHtml(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[generate-pdf] Error during HTML/PDF generation:", err);
    return res.status(500).json({ error: message || "Erreur lors de la génération du PDF" });
  }
}

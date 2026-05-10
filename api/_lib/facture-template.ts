/**
 * Template HTML facture véhicule (PDF via Puppeteer — même pipeline que generate-pdf.ts).
 */

export type PrestationFacture = { libelle: string; prix_ht: number };

export type FactureTemplatePayload = {
  numero_facture: string;
  date_facture_label: string;
  date_livraison_label: string;

  concession_nom: string;
  concession_siret: string;
  concession_adresse: string;
  concession_telephone: string;
  concession_email: string;
  concession_tva_intra: string;

  client_nom: string;
  client_prenom: string;
  client_adresse: string;
  client_email: string;
  client_telephone: string;

  vehicule_marque: string;
  vehicule_modele: string;
  vehicule_version: string;
  vehicule_type: string;
  vehicule_premiere_circulation: string;
  vehicule_kilometrage: string;
  vehicule_km_non_garanti: boolean;
  vehicule_vin: string;
  vehicule_immatriculation: string;
  vehicule_couleur: string;
  vehicule_energie: string;

  prestations: PrestationFacture[];

  prix_ht_vehicule_label: string;
  prix_ht_prestations_label: string;
  prix_ht_total_label: string;
  tva_taux_label: string;
  tva_montant_label: string;
  prix_ttc_label: string;
  acompte_label: string;
  reprise_montant_label: string;
  reprise_description: string;
  reste_a_payer_label: string;

  mention_garantie_vente: string;
  notes: string;
};

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoneyFr(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildFactureHtml(p: FactureTemplatePayload): string {
  const livraisonRaw = String(p.date_livraison_label ?? "").trim();
  const livraisonLabel =
    livraisonRaw && livraisonRaw !== "—"
      ? livraisonRaw
      : "À définir";

  const prestRows =
    p.prestations.length === 0
      ? `<tr><td colspan="2" style="padding:8px;border:1px solid #ccc;color:#666;font-style:italic;">Aucune prestation supplémentaire</td></tr>`
      : p.prestations
          .map(
            (pr) =>
              `<tr><td style="padding:6px 8px;border:1px solid #ccc;">${esc(pr.libelle)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #ccc;text-align:right;white-space:nowrap;">${esc(formatMoneyFr(pr.prix_ht))} €</td></tr>`,
          )
          .join("");

  const notesBlock =
    (p.notes ?? "").trim().length > 0
      ? `<div class="notes-box"><strong>Notes</strong><br/>${esc(p.notes.trim()).replace(/\n/g, "<br/>")}</div>`
      : "";

  const repriseBlock =
    parseFloat(String(p.reprise_montant_label).replace(/\s/g, "").replace(",", ".")) > 0
      ? `<div class="price-row"><span>Reprise véhicule déduite</span><span>− ${esc(p.reprise_montant_label)} €</span></div>
         ${(p.reprise_description ?? "").trim() ? `<div class="reprise-desc">${esc(p.reprise_description.trim())}</div>` : ""}`
      : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    font-size: 10.5px;
    color: #111;
    line-height: 1.45;
    position: relative;
  }
  .watermark {
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 64px;
    font-weight: 800;
    color: #000;
    opacity: 0.045;
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }
  .wrap { position: relative; z-index: 1; }
  .doc-title {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 2px;
    text-align: right;
    margin-bottom: 4px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #000;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .concession h1 { font-size: 15px; font-weight: 800; margin-bottom: 4px; }
  .concession .small { font-size: 9px; color: #333; line-height: 1.35; }
  .meta { text-align: right; font-size: 10px; }
  .meta .num { font-size: 13px; font-weight: 800; margin-bottom: 4px; }
  .section { margin-bottom: 10px; }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: #000;
    color: #fff;
    padding: 4px 8px;
    margin-bottom: 0;
  }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th, table.grid td {
    border: 1px solid #ccc;
    padding: 5px 8px;
    font-size: 10px;
    vertical-align: top;
  }
  table.grid th {
    background: #f4f4f4;
    font-weight: 600;
    width: 22%;
    white-space: nowrap;
  }
  .price-box {
    border: 1px solid #000;
    padding: 10px 12px;
    margin-top: 8px;
  }
  .price-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 10.5px;
  }
  .price-row.emphasis { font-weight: 700; font-size: 11px; border-top: 1px dashed #999; margin-top: 6px; padding-top: 8px; }
  .reste-box {
    margin-top: 10px;
    border: 3px double #000;
    padding: 10px 12px;
    text-align: center;
    font-weight: 800;
    font-size: 14px;
  }
  .reste-box span { display: block; font-size: 10px; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
  .legal {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #ccc;
    font-size: 8.5px;
    color: #222;
    line-height: 1.45;
  }
  .legal p { margin-bottom: 6px; }
  .legal strong { font-weight: 700; }
  .notes-box { margin-top: 8px; padding: 8px; border: 1px dashed #999; font-size: 9px; }
  .reprise-desc { font-size: 9px; color: #444; margin-top: 4px; font-style: italic; }
</style>
</head>
<body>
<div class="watermark">AutoDocs</div>
<div class="wrap">

  <div class="doc-title">FACTURE</div>

  <div class="header">
    <div class="concession">
      <h1>${esc(p.concession_nom)}</h1>
      <div class="small">
        ${esc(p.concession_adresse)}<br/>
        Tél. ${esc(p.concession_telephone)} — ${esc(p.concession_email)}<br/>
        SIRET : ${esc(p.concession_siret)} — TVA intracom. : ${esc(p.concession_tva_intra)}
      </div>
    </div>
    <div class="meta">
      <div class="num">N° ${esc(p.numero_facture)}</div>
      <div>Date de facture : <strong>${esc(p.date_facture_label)}</strong></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Client (acheteur)</div>
    <table class="grid">
      <tr><th>Nom</th><td>${esc(p.client_nom)}</td><th>Prénom</th><td>${esc(p.client_prenom)}</td></tr>
      <tr><th>Adresse</th><td colspan="3">${esc(p.client_adresse)}</td></tr>
      <tr><th>Email</th><td>${esc(p.client_email)}</td><th>Téléphone</th><td>${esc(p.client_telephone)}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Détail du véhicule</div>
    <table class="grid">
      <tr><th>Marque</th><td>${esc(p.vehicule_marque)}</td><th>Type / genre</th><td>${esc(p.vehicule_type)}</td></tr>
      <tr><th>Modèle</th><td>${esc(p.vehicule_modele)}</td><th>Version</th><td>${esc(p.vehicule_version)}</td></tr>
      <tr><th>1ère mise en circulation</th><td colspan="3">${esc(p.vehicule_premiere_circulation)}</td></tr>
      <tr><th>Kilométrage</th><td colspan="3">${p.vehicule_km_non_garanti ? "<strong>Non garanti</strong>" : esc(p.vehicule_kilometrage)}</td></tr>
      <tr><th>N° VIN (numéro de série)</th><td colspan="3">${esc(p.vehicule_vin)}</td></tr>
      <tr><th>N° d'immatriculation</th><td>${esc(p.vehicule_immatriculation)}</td><th>Couleur</th><td>${esc(p.vehicule_couleur)}</td></tr>
      <tr><th>Énergie</th><td colspan="3">${esc(p.vehicule_energie)}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Prestations supplémentaires (hors véhicule)</div>
    <table class="grid">
      <tr style="background:#f4f4f4;font-weight:700;"><td style="border:1px solid #ccc;">Libellé</td><td style="border:1px solid #ccc;width:120px;text-align:right;">Prix HT</td></tr>
      ${prestRows}
    </table>
  </div>

  <div class="price-box">
    <div class="price-row"><span>Prix HT véhicule</span><span>${esc(p.prix_ht_vehicule_label)} €</span></div>
    <div class="price-row"><span>Total HT prestations</span><span>${esc(p.prix_ht_prestations_label)} €</span></div>
    <div class="price-row emphasis"><span>Total HT</span><span>${esc(p.prix_ht_total_label)} €</span></div>
    <div class="price-row"><span>TVA (${esc(p.tva_taux_label)} %)</span><span>${esc(p.tva_montant_label)} €</span></div>
    <div class="price-row emphasis"><span>Total TTC</span><span>${esc(p.prix_ttc_label)} €</span></div>
    <div class="price-row"><span>Acompte versé</span><span>− ${esc(p.acompte_label)} €</span></div>
    ${repriseBlock}
    <div class="reste-box">
      <span>Reste à payer</span>
      ${esc(p.reste_a_payer_label)} € TTC
    </div>
    <div class="price-row" style="margin-top:8px;border-top:1px dashed #999;padding-top:8px;">
      <span>Date de livraison du véhicule</span>
      <span>${esc(livraisonLabel)}</span>
    </div>
  </div>

  ${notesBlock}

  <div class="legal">
    <p><strong>Conditions de vente et mentions légales</strong></p>
    <p>${esc(p.mention_garantie_vente)}</p>
    <p>Le vendeur déclare que le véhicule est <strong>libre de tout gage et opposition</strong> au jour de la vente.</p>
    <p>Les <strong>pièces administratives</strong> nécessaires à la circulation et à la revente ont été ou seront <strong>remises à l'acheteur</strong> conformément à la réglementation applicable.</p>
    <p><strong>Garantie légale de conformité</strong> : pour les acheteurs qualifiés de consommateurs, le véhicule bénéficie de la garantie légale de conformité prévue aux articles L. 217-3 et suivants du Code de la consommation, dans les conditions fixées par le décret n° 2021-609 du 19 mai 2021 et les textes subséquents.</p>
    <p>${p.vehicule_km_non_garanti ? "Le kilométrage est indiqué <strong>sans garantie</strong> au moment de la vente." : "Le vendeur déclare que le <strong>kilométrage indiqué est exact</strong> au moment de la vente."}</p>
    <p><strong>Conservation du document</strong> : ce document doit être conservé <strong>10 ans</strong> par le vendeur et l'acheteur aux fins notamment de justification fiscale et de garanties.</p>
  </div>

</div>
</body>
</html>`;
}

/** Alias camelCase / nom alternatif attendu par certains appels API. */
export const buildFactureHTML = buildFactureHtml;

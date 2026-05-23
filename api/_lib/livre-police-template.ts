export function buildLivrePoliceHTML(
  entrees: any[],
  concession: any,
): string {
  const rows =
    entrees
      ?.map(
        (e) => `
    <tr>
      <td>${e.numero_ordre || "—"}</td>
      <td>${
        e.date_entree ? new Date(e.date_entree).toLocaleDateString("fr-FR") : "—"
      }</td>
      <td>${e.genre || "—"}</td>
      <td>${e.marque || "—"}</td>
      <td>${e.modele || "—"}</td>
      <td>${e.type_variante_version || "—"}</td>
      <td>${e.couleur || "—"}</td>
      <td>${e.annee_mise_en_circulation || "—"}</td>
      <td>${
        e.kilometrage ? Number(e.kilometrage).toLocaleString("fr-FR") : "—"
      }</td>
      <td>${e.immatriculation || "—"}</td>
      <td>${e.vin || "—"}</td>
      <td>${e.pays_origine || "France"}</td>
      <td>${
        e.vendeur_type === "entreprise"
          ? e.vendeur_entreprise_nom || "—"
          : `${e.vendeur_nom || ""} ${e.vendeur_prenom || ""}`.trim() || "—"
      }</td>
      <td>${
        e.vendeur_type === "entreprise"
          ? e.vendeur_siret || "—"
          : e.vendeur_numero_piece_identite || "—"
      }</td>
      <td>${
        e.prix_achat
          ? Number(e.prix_achat).toLocaleString("fr-FR") + " €"
          : "—"
      }</td>
      <td>${e.mode_reglement_achat || "—"}</td>
      <td>${
        e.acheteur_type === "entreprise"
          ? e.acheteur_entreprise_nom || "—"
          : `${e.acheteur_nom || ""} ${e.acheteur_prenom || ""}`.trim() || "—"
      }</td>
      <td>${
        e.acheteur_type === "entreprise"
          ? e.acheteur_siret || "—"
          : e.acheteur_numero_piece_identite || "—"
      }</td>
      <td>${
        e.prix_vente
          ? Number(e.prix_vente).toLocaleString("fr-FR") + " €"
          : "—"
      }</td>
      <td>${e.mode_reglement_vente || "—"}</td>
      <td>${
        e.date_sortie ? new Date(e.date_sortie).toLocaleDateString("fr-FR") : "—"
      }</td>
      <td>${e.destination_sortie || "—"}</td>
    </tr>
  `,
      )
      .join("") ||
    '<tr><td colspan="22" style="text-align:center">Aucune entrée</td></tr>';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 8px; margin: 0; }
  h1 { font-size: 13px; text-align: center; margin-bottom: 4px; }
  .header { text-align: center; margin-bottom: 16px; }
  .header p { font-size: 9px; color: #555; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th {
    background: #1e3a5f; color: white;
    padding: 4px 3px; font-size: 7px;
    border: 1px solid #ccc; white-space: nowrap;
  }
  td {
    padding: 3px; border: 1px solid #ddd;
    font-size: 7px; vertical-align: top;
    max-width: 80px; overflow: hidden;
  }
  tr:nth-child(even) { background: #f9f9f9; }
  .footer {
    margin-top: 16px; font-size: 7px;
    color: #666; text-align: center;
    border-top: 1px solid #ddd; padding-top: 8px;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>LIVRE DE POLICE — REGISTRE DES VÉHICULES D'OCCASION</h1>
    <p><strong>${concession?.nom || "Concession"}</strong>${concession?.siret ? ` — SIRET : ${concession.siret}` : ""}</p>
    <p>Édité le ${new Date().toLocaleDateString("fr-FR")}</p>
  </div>
  <table>
    <thead>
      <tr>
        <th>N°</th><th>Date entrée</th><th>Genre</th>
        <th>Marque</th><th>Modèle</th><th>TVV</th>
        <th>Couleur</th><th>1ère MEC</th><th>KM</th>
        <th>Immat</th><th>VIN</th><th>Pays</th>
        <th>Vendeur</th><th>N° ID vendeur</th>
        <th>Prix achat</th><th>Règl. achat</th>
        <th>Acheteur</th><th>N° ID acheteur</th>
        <th>Prix vente</th><th>Règl. vente</th>
        <th>Date sortie</th><th>Destination</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    Document conforme aux obligations légales du livre de police automobile 
    (Article L321-1 du Code de la Sécurité Intérieure). 
    Ce registre doit être conservé 5 ans après la dernière inscription.
  </div>
</body>
</html>`;
}

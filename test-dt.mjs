// src/lib/pdfFieldMapping.ts
var BON_DRAFT_KEYS = [
  "clientNom",
  "clientPrenom",
  "clientDateNaissance",
  "clientNumeroCni",
  "clientAdresse",
  "ribTitulaire",
  "ribIban",
  "ribBic",
  "ribBanque",
  "clientEmail",
  "clientTelephone",
  "vehiculeModele",
  "vehiculeVin",
  "vehiculePremiereCirculation",
  "vehiculeKilometrage",
  "vehiculeCo2",
  "vehiculeChevaux",
  "vehiculePrix",
  "optionsMode",
  "optionsPrixTotal",
  "optionsDetailJson",
  "vehiculeCarteGrise",
  "vehiculeFraisReprise",
  "vehiculeRemise",
  "vehiculeFinancement",
  "vehiculeDateLivraison",
  "vehiculeReprise",
  "vehiculeCouleur",
  "vehiculeOptions",
  "acompte",
  "modePaiement",
  "apport",
  "organismePreteur",
  "montantCredit",
  "tauxCredit",
  "dureeMois",
  "clauseSuspensive",
  "vendeurNom",
  "vendeurNotes",
  "templateId"
];

// api/debug-test.ts
async function handler(req, res) {
  return res.status(200).json({ ok: true, count: BON_DRAFT_KEYS.length });
}
export {
  handler as default
};

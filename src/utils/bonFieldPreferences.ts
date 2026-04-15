export type StandardVehiculeVenteField = {
  key: string;
  label: string;
  section: "vehicule" | "vente";
};

export const STANDARD_VEHICULE_VENTE_FIELDS: StandardVehiculeVenteField[] = [
  { key: "vehiculeModele", label: "Modèle du véhicule", section: "vehicule" },
  { key: "vehiculeVin", label: "VIN / N° de châssis", section: "vehicule" },
  {
    key: "vehiculePremiereCirculation",
    label: "1ère mise en circulation",
    section: "vehicule",
  },
  { key: "vehiculeKilometrage", label: "Kilométrage", section: "vehicule" },
  { key: "vehiculeCo2", label: "Émission CO2", section: "vehicule" },
  { key: "vehiculeChevaux", label: "Chevaux", section: "vehicule" },
  { key: "vehiculePrix", label: "Prix de vente TTC", section: "vente" },
  { key: "optionsMode", label: "Mode options", section: "vente" },
  { key: "optionsPrixTotal", label: "Prix total options", section: "vente" },
  { key: "optionsDetailJson", label: "Détail options", section: "vente" },
  { key: "vehiculeCarteGrise", label: "Carte grise", section: "vente" },
  { key: "vehiculeFraisReprise", label: "Frais de reprise", section: "vente" },
  { key: "vehiculeRemise", label: "Remise", section: "vente" },
  {
    key: "vehiculeFinancement",
    label: "Type de financement",
    section: "vente",
  },
  { key: "acompte", label: "Acompte", section: "vente" },
  { key: "modePaiement", label: "Mode de paiement", section: "vente" },
  { key: "apport", label: "Apport", section: "vente" },
  { key: "organismePreteur", label: "Organisme prêteur", section: "vente" },
  { key: "montantCredit", label: "Montant crédit", section: "vente" },
  { key: "tauxCredit", label: "Taux crédit", section: "vente" },
  { key: "dureeMois", label: "Durée (mois)", section: "vente" },
  {
    key: "clauseSuspensive",
    label: "Clause suspensive de crédit",
    section: "vente",
  },
  { key: "vehiculeDateLivraison", label: "Date de livraison", section: "vente" },
  { key: "vehiculeReprise", label: "Reprise véhicule", section: "vente" },
  { key: "vehiculeCouleur", label: "Couleur / finition", section: "vehicule" },
  { key: "vendeurNom", label: "Vendeur", section: "vente" },
  { key: "vendeurNotes", label: "Notes vendeur", section: "vente" },
];

type FieldPrefs = {
  hiddenKeys: string[];
};

const DEFAULT_PREFS: FieldPrefs = {
  hiddenKeys: [],
};

function storageKey(userId: string) {
  return `autodocs:field-prefs:${userId}`;
}

export function loadFieldPreferences(userId: string): FieldPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<FieldPrefs>;
    const hiddenKeys = Array.isArray(parsed.hiddenKeys)
      ? parsed.hiddenKeys.map((v) => String(v))
      : [];
    return { hiddenKeys };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveFieldPreferences(userId: string, prefs: FieldPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
}


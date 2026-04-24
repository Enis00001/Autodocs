import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

/**
 * Préférences de visibilité des champs du formulaire « Nouveau bon ».
 *
 * Chaque clé ON = champ affiché dans le formulaire ET injecté dans le PDF.
 * Chaque clé OFF = champ masqué partout (formulaire + PDF).
 *
 * Les préférences sont stockées dans la table Supabase `preferences_formulaire`
 * (colonne `champs_actifs` jsonb) avec une ligne par utilisateur.
 */

export type ClientFieldKey =
  | "nom"
  | "prenom"
  | "dateNaissance"
  | "numeroCni"
  | "adresse";

export type VehiculeFieldKey =
  | "modele"
  | "prix"
  | "vin"
  | "kilometrage"
  | "couleur"
  | "puissance"
  | "co2"
  | "premiereCirculation"
  | "carburant";

export type RepriseFieldKey =
  | "plaque"
  | "marque"
  | "modele"
  | "vin"
  | "premiereCirculation"
  | "valeur"
  | "dureeMois";

export type FormFieldPrefs = {
  client: Record<ClientFieldKey, boolean>;
  vehicule: Record<VehiculeFieldKey, boolean>;
  reprise: Record<RepriseFieldKey, boolean>;
};

export const CLIENT_FIELD_LABELS: Record<ClientFieldKey, string> = {
  nom: "Nom",
  prenom: "Prénom",
  dateNaissance: "Date de naissance",
  numeroCni: "Numéro CNI",
  adresse: "Adresse",
};

export const VEHICULE_FIELD_LABELS: Record<VehiculeFieldKey, string> = {
  modele: "Modèle",
  prix: "Prix",
  vin: "VIN",
  kilometrage: "Kilométrage",
  couleur: "Couleur",
  puissance: "Puissance",
  co2: "CO2",
  premiereCirculation: "Première circulation",
  carburant: "Carburant",
};

export const REPRISE_FIELD_LABELS: Record<RepriseFieldKey, string> = {
  plaque: "Plaque",
  marque: "Marque",
  modele: "Modèle",
  vin: "VIN",
  premiereCirculation: "Première circulation",
  valeur: "Valeur",
  dureeMois: "Durée (mois)",
};

export const DEFAULT_FORM_PREFS: FormFieldPrefs = {
  client: {
    nom: true,
    prenom: true,
    dateNaissance: true,
    numeroCni: true,
    adresse: true,
  },
  vehicule: {
    modele: true,
    prix: true,
    vin: true,
    kilometrage: true,
    couleur: true,
    puissance: true,
    co2: true,
    premiereCirculation: true,
    carburant: true,
  },
  reprise: {
    plaque: true,
    marque: true,
    modele: true,
    vin: true,
    premiereCirculation: true,
    valeur: true,
    dureeMois: true,
  },
};

function mergeWithDefault(raw: unknown): FormFieldPrefs {
  const safe = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const getBool = (
    section: Record<string, unknown> | undefined,
    key: string,
    fallback: boolean,
  ): boolean => {
    if (!section) return fallback;
    const v = section[key];
    if (typeof v === "boolean") return v;
    return fallback;
  };
  const rawClient = safe.client as Record<string, unknown> | undefined;
  const rawVehicule = safe.vehicule as Record<string, unknown> | undefined;
  const rawReprise = safe.reprise as Record<string, unknown> | undefined;
  return {
    client: {
      nom: getBool(rawClient, "nom", DEFAULT_FORM_PREFS.client.nom),
      prenom: getBool(rawClient, "prenom", DEFAULT_FORM_PREFS.client.prenom),
      dateNaissance: getBool(rawClient, "dateNaissance", DEFAULT_FORM_PREFS.client.dateNaissance),
      numeroCni: getBool(rawClient, "numeroCni", DEFAULT_FORM_PREFS.client.numeroCni),
      adresse: getBool(rawClient, "adresse", DEFAULT_FORM_PREFS.client.adresse),
    },
    vehicule: {
      modele: getBool(rawVehicule, "modele", DEFAULT_FORM_PREFS.vehicule.modele),
      prix: getBool(rawVehicule, "prix", DEFAULT_FORM_PREFS.vehicule.prix),
      vin: getBool(rawVehicule, "vin", DEFAULT_FORM_PREFS.vehicule.vin),
      kilometrage: getBool(rawVehicule, "kilometrage", DEFAULT_FORM_PREFS.vehicule.kilometrage),
      couleur: getBool(rawVehicule, "couleur", DEFAULT_FORM_PREFS.vehicule.couleur),
      puissance: getBool(rawVehicule, "puissance", DEFAULT_FORM_PREFS.vehicule.puissance),
      co2: getBool(rawVehicule, "co2", DEFAULT_FORM_PREFS.vehicule.co2),
      premiereCirculation: getBool(
        rawVehicule,
        "premiereCirculation",
        DEFAULT_FORM_PREFS.vehicule.premiereCirculation,
      ),
      carburant: getBool(rawVehicule, "carburant", DEFAULT_FORM_PREFS.vehicule.carburant),
    },
    reprise: {
      plaque: getBool(rawReprise, "plaque", DEFAULT_FORM_PREFS.reprise.plaque),
      marque: getBool(rawReprise, "marque", DEFAULT_FORM_PREFS.reprise.marque),
      modele: getBool(rawReprise, "modele", DEFAULT_FORM_PREFS.reprise.modele),
      vin: getBool(rawReprise, "vin", DEFAULT_FORM_PREFS.reprise.vin),
      premiereCirculation: getBool(
        rawReprise,
        "premiereCirculation",
        DEFAULT_FORM_PREFS.reprise.premiereCirculation,
      ),
      valeur: getBool(rawReprise, "valeur", DEFAULT_FORM_PREFS.reprise.valeur),
      dureeMois: getBool(rawReprise, "dureeMois", DEFAULT_FORM_PREFS.reprise.dureeMois),
    },
  };
}

export async function loadFormPrefs(): Promise<FormFieldPrefs> {
  const userId = await getCurrentUserId();
  if (!userId) return DEFAULT_FORM_PREFS;
  const { data, error } = await supabase
    .from("preferences_formulaire")
    .select("champs_actifs")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("loadFormPrefs:", error);
    return DEFAULT_FORM_PREFS;
  }
  if (!data) return DEFAULT_FORM_PREFS;
  return mergeWithDefault((data as { champs_actifs?: unknown }).champs_actifs);
}

export async function saveFormPrefs(prefs: FormFieldPrefs): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Session expirée. Reconnectez-vous pour sauvegarder les préférences.");
  }
  const { data: existing, error: selErr } = await supabase
    .from("preferences_formulaire")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) {
    console.error("saveFormPrefs (select):", selErr);
    throw new Error(selErr.message || "Erreur lors du chargement des préférences.");
  }
  if (existing?.id) {
    const { error } = await supabase
      .from("preferences_formulaire")
      .update({ champs_actifs: prefs })
      .eq("id", (existing as { id: string }).id);
    if (error) {
      console.error("saveFormPrefs (update):", error);
      throw new Error(error.message || "Erreur lors de la sauvegarde des préférences.");
    }
  } else {
    const { error } = await supabase
      .from("preferences_formulaire")
      .insert({ user_id: userId, champs_actifs: prefs });
    if (error) {
      console.error("saveFormPrefs (insert):", error);
      throw new Error(error.message || "Erreur lors de la sauvegarde des préférences.");
    }
  }
}

/**
 * Normalise une chaîne pour comparaison (minuscules, sans accent, sans
 * caractères non alphanumériques). Permet de reconnaître "Modèle", "modele",
 * "MODÈLE", etc. comme la même clé.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Synonymes des colonnes stock vers une clé véhicule connue. */
const VEHICULE_KEY_ALIASES: Record<VehiculeFieldKey, string[]> = {
  modele: ["modele", "model"],
  prix: ["prix", "price", "tarif", "tarifttc", "prixttc", "prixht"],
  vin: ["vin", "numerovin", "chassis", "numerochassis", "novin"],
  kilometrage: ["kilometrage", "km", "kilometres", "kilometers", "mileage"],
  couleur: ["couleur", "color", "finition", "couleurfinition"],
  puissance: ["puissance", "chevaux", "cv", "ch", "kw", "puissancefiscale"],
  co2: ["co2", "emissionsco2", "emissionco2"],
  premiereCirculation: [
    "premierecirculation",
    "premieremiseencirculation",
    "miseencirculation",
    "datemec",
    "mec",
  ],
  carburant: ["carburant", "fuel", "energie", "energy"],
};

/**
 * Retourne la clé véhicule canonique qui matche le nom de colonne stock
 * donné (ou null si aucun alias ne matche).
 */
export function matchVehiculeKey(columnName: string): VehiculeFieldKey | null {
  const norm = normalize(columnName);
  if (!norm) return null;
  for (const [key, aliases] of Object.entries(VEHICULE_KEY_ALIASES) as Array<
    [VehiculeFieldKey, string[]]
  >) {
    if (aliases.includes(norm)) return key;
  }
  return null;
}

/**
 * Retourne `true` si la colonne stock doit être affichée compte-tenu des
 * préférences. Les colonnes non reconnues (ex: champs custom "Options", etc.)
 * restent toujours visibles pour ne pas casser l'existant.
 */
export function isStockColumnVisible(columnName: string, prefs: FormFieldPrefs): boolean {
  const matched = matchVehiculeKey(columnName);
  if (!matched) return true;
  return prefs.vehicule[matched];
}

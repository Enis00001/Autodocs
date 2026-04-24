import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

export type FieldSection = "client" | "vehicule" | "reprise" | "reglement";
export type FieldType = "text" | "number" | "date";

export type FormFieldDefinition = {
  id: string;
  key: string;
  label: string;
  section: FieldSection;
  type: FieldType;
  enabled: boolean;
  isCustom: boolean;
};

export type FormFieldPrefs = {
  fields: FormFieldDefinition[];
};

const STANDARD_FIELDS: FormFieldDefinition[] = [
  { id: "std_client_nom", key: "clientNom", label: "Nom", section: "client", type: "text", enabled: true, isCustom: false },
  { id: "std_client_prenom", key: "clientPrenom", label: "Prénom", section: "client", type: "text", enabled: true, isCustom: false },
  { id: "std_client_date_naissance", key: "clientDateNaissance", label: "Date de naissance", section: "client", type: "date", enabled: true, isCustom: false },
  { id: "std_client_numero_cni", key: "clientNumeroCni", label: "Numéro CNI", section: "client", type: "text", enabled: true, isCustom: false },
  { id: "std_client_adresse", key: "clientAdresse", label: "Adresse", section: "client", type: "text", enabled: true, isCustom: false },

  { id: "std_vehicule_modele", key: "modele", label: "Modèle", section: "vehicule", type: "text", enabled: true, isCustom: false },
  { id: "std_vehicule_prix", key: "prix", label: "Prix", section: "vehicule", type: "number", enabled: true, isCustom: false },
  { id: "std_vehicule_vin", key: "vin", label: "VIN", section: "vehicule", type: "text", enabled: true, isCustom: false },
  { id: "std_vehicule_kilometrage", key: "kilometrage", label: "Kilométrage", section: "vehicule", type: "number", enabled: true, isCustom: false },
  { id: "std_vehicule_couleur", key: "couleur", label: "Couleur", section: "vehicule", type: "text", enabled: true, isCustom: false },
  { id: "std_vehicule_puissance", key: "puissance", label: "Puissance", section: "vehicule", type: "text", enabled: true, isCustom: false },
  { id: "std_vehicule_co2", key: "co2", label: "CO2", section: "vehicule", type: "number", enabled: true, isCustom: false },
  { id: "std_vehicule_premiere_circulation", key: "premiereCirculation", label: "Première circulation", section: "vehicule", type: "date", enabled: true, isCustom: false },
  { id: "std_vehicule_carburant", key: "carburant", label: "Carburant", section: "vehicule", type: "text", enabled: true, isCustom: false },

  { id: "std_reprise_plaque", key: "reprisePlaque", label: "Plaque", section: "reprise", type: "text", enabled: true, isCustom: false },
  { id: "std_reprise_marque", key: "repriseMarque", label: "Marque", section: "reprise", type: "text", enabled: true, isCustom: false },
  { id: "std_reprise_modele", key: "repriseModele", label: "Modèle", section: "reprise", type: "text", enabled: true, isCustom: false },
  { id: "std_reprise_vin", key: "repriseVin", label: "VIN", section: "reprise", type: "text", enabled: true, isCustom: false },
  { id: "std_reprise_premiere_circulation", key: "reprisePremiereCirculation", label: "Première circulation", section: "reprise", type: "date", enabled: true, isCustom: false },
  { id: "std_reprise_valeur", key: "repriseValeur", label: "Valeur", section: "reprise", type: "number", enabled: true, isCustom: false },
  { id: "std_reprise_duree_mois", key: "repriseDureeMois", label: "Durée (mois)", section: "reprise", type: "number", enabled: true, isCustom: false },

  { id: "std_reglement_mode_paiement", key: "modePaiement", label: "Mode de paiement", section: "reglement", type: "text", enabled: true, isCustom: false },
  { id: "std_reglement_prix", key: "vehiculePrix", label: "Prix du véhicule", section: "reglement", type: "number", enabled: true, isCustom: false },
  { id: "std_reglement_remise", key: "vehiculeRemise", label: "Remise", section: "reglement", type: "number", enabled: true, isCustom: false },
  { id: "std_reglement_acompte", key: "acompte", label: "Acompte", section: "reglement", type: "number", enabled: true, isCustom: false },
  { id: "std_reglement_date_livraison", key: "vehiculeDateLivraison", label: "Date de livraison", section: "reglement", type: "date", enabled: true, isCustom: false },
];

export const DEFAULT_FORM_PREFS: FormFieldPrefs = {
  fields: STANDARD_FIELDS,
};

export const SECTIONS: Array<{ key: FieldSection; title: string }> = [
  { key: "client", title: "Client" },
  { key: "vehicule", title: "Véhicule" },
  { key: "reprise", title: "Reprise" },
  { key: "reglement", title: "Règlement" },
];

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function mergeWithDefault(raw: unknown): FormFieldPrefs {
  const safe = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const maybeFields = Array.isArray(safe.fields) ? safe.fields : null;
  if (maybeFields) {
    const out: FormFieldDefinition[] = [];
    for (const item of maybeFields) {
      if (!item || typeof item !== "object") continue;
      const f = item as Record<string, unknown>;
      const section = f.section;
      const type = f.type;
      if (section !== "client" && section !== "vehicule" && section !== "reprise" && section !== "reglement") continue;
      if (type !== "text" && type !== "number" && type !== "date") continue;
      out.push({
        id: String(f.id ?? crypto.randomUUID?.() ?? Date.now()),
        key: String(f.key ?? ""),
        label: String(f.label ?? ""),
        section,
        type,
        enabled: Boolean(f.enabled ?? true),
        isCustom: Boolean(f.isCustom),
      });
    }
    const stdById = new Map(STANDARD_FIELDS.map((x) => [x.id, x]));
    for (const std of STANDARD_FIELDS) {
      if (!out.some((f) => f.id === std.id)) out.push(std);
    }
    return {
      fields: out.map((f) => {
        const std = stdById.get(f.id);
        if (!std) return f;
        return { ...std, label: f.label || std.label, enabled: f.enabled };
      }),
    };
  }

  // Compat ancien format { client: {..}, vehicule: {..}, reprise: {..} }
  const legacy = safe;
  const fields = STANDARD_FIELDS.map((f) => {
    if (f.section === "client") {
      const section = legacy.client as Record<string, unknown> | undefined;
      const map: Record<string, string> = {
        clientNom: "nom",
        clientPrenom: "prenom",
        clientDateNaissance: "dateNaissance",
        clientNumeroCni: "numeroCni",
        clientAdresse: "adresse",
      };
      return { ...f, enabled: typeof section?.[map[f.key]] === "boolean" ? Boolean(section?.[map[f.key]]) : f.enabled };
    }
    if (f.section === "vehicule") {
      const section = legacy.vehicule as Record<string, unknown> | undefined;
      return { ...f, enabled: typeof section?.[f.key] === "boolean" ? Boolean(section?.[f.key]) : f.enabled };
    }
    if (f.section === "reprise") {
      const section = legacy.reprise as Record<string, unknown> | undefined;
      const map: Record<string, string> = {
        reprisePlaque: "plaque",
        repriseMarque: "marque",
        repriseModele: "modele",
        repriseVin: "vin",
        reprisePremiereCirculation: "premiereCirculation",
        repriseValeur: "valeur",
        repriseDureeMois: "dureeMois",
      };
      return { ...f, enabled: typeof section?.[map[f.key]] === "boolean" ? Boolean(section?.[map[f.key]]) : f.enabled };
    }
    return f;
  });
  return { fields };
}

export function getFieldsBySection(prefs: FormFieldPrefs, section: FieldSection): FormFieldDefinition[] {
  return prefs.fields.filter((f) => f.section === section);
}

export function isFieldEnabled(prefs: FormFieldPrefs, key: string): boolean {
  const field = prefs.fields.find((f) => f.key === key);
  return field ? field.enabled : true;
}

export function getCustomFieldsBySection(prefs: FormFieldPrefs, section: FieldSection): FormFieldDefinition[] {
  return prefs.fields.filter((f) => f.section === section && f.isCustom && f.enabled);
}

const VEHICULE_KEY_ALIASES: Record<string, string[]> = {
  modele: ["modele", "model"],
  prix: ["prix", "price", "tarif", "tarifttc", "prixttc", "prixht"],
  vin: ["vin", "numerovin", "chassis", "numerochassis", "novin"],
  kilometrage: ["kilometrage", "km", "kilometres", "kilometers", "mileage"],
  couleur: ["couleur", "color", "finition", "couleurfinition"],
  puissance: ["puissance", "chevaux", "cv", "ch", "kw", "puissancefiscale"],
  co2: ["co2", "emissionsco2", "emissionco2"],
  premiereCirculation: ["premierecirculation", "premieremiseencirculation", "miseencirculation", "datemec", "mec"],
  carburant: ["carburant", "fuel", "energie", "energy"],
};

export function matchVehiculeKey(columnName: string): string | null {
  const norm = normalize(columnName);
  if (!norm) return null;
  for (const [key, aliases] of Object.entries(VEHICULE_KEY_ALIASES)) {
    if (aliases.includes(norm)) return key;
  }
  return null;
}

export function isStockColumnVisible(columnName: string, prefs: FormFieldPrefs): boolean {
  const matched = matchVehiculeKey(columnName);
  if (!matched) return true;
  return isFieldEnabled(prefs, matched);
}

export async function loadFormPrefs(): Promise<FormFieldPrefs> {
  const userId = await getCurrentUserId();
  if (!userId) return DEFAULT_FORM_PREFS;
  const { data, error } = await supabase.from("preferences_formulaire").select("champs_actifs").eq("user_id", userId).maybeSingle();
  if (error) {
    console.error("loadFormPrefs:", error);
    return DEFAULT_FORM_PREFS;
  }
  if (!data) return DEFAULT_FORM_PREFS;
  return mergeWithDefault((data as { champs_actifs?: unknown }).champs_actifs);
}

export async function saveFormPrefs(prefs: FormFieldPrefs): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Session expirée. Reconnectez-vous pour sauvegarder.");
  const { data: existing, error: selErr } = await supabase.from("preferences_formulaire").select("id").eq("user_id", userId).maybeSingle();
  if (selErr) throw new Error(selErr.message || "Erreur de chargement des préférences.");
  if (existing?.id) {
    const { error } = await supabase.from("preferences_formulaire").update({ champs_actifs: prefs }).eq("id", (existing as { id: string }).id);
    if (error) throw new Error(error.message || "Erreur de sauvegarde des préférences.");
  } else {
    const { error } = await supabase.from("preferences_formulaire").insert({ user_id: userId, champs_actifs: prefs });
    if (error) throw new Error(error.message || "Erreur de sauvegarde des préférences.");
  }
}

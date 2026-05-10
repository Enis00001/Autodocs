import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

/**
 * V2 — schéma libre. Un véhicule en stock est un sac de clé/valeur (`donnees`)
 * issu directement du fichier CSV/Excel. La V2.1 réintroduit quelques champs
 * typés (marque, modele, prix, statut…) pour offrir une saisie manuelle propre
 * et permettre des filtres rapides (recherche, tabs statut), sans renoncer au
 * pipeline schemaless utilisé par l'import CSV.
 *
 * - `donnees` : paires clé/valeur (clé = nom de colonne ou label métier)
 * - `colonnes_pdf` : liste ordonnée des clés à afficher dans le PDF / le form
 * - colonnes typées : utilisées par la liste/recherche/filtres dans l'UI stock
 * - `statut` : "disponible" / "réservé" / "vendu" — source de vérité unique.
 *   `disponible` (boolean) est conservé pour compat ascendante et toujours
 *   maintenu en synchro (`disponible = statut === "disponible"`).
 */
export type StatutVehicule = "disponible" | "réservé" | "vendu";

export const STATUTS_VEHICULE: StatutVehicule[] = ["disponible", "réservé", "vendu"];

export type StockVehicule = {
  id: string;
  concession_id: string | null;
  donnees: Record<string, string>;
  colonnes_pdf: string[];
  /** Source de vérité dérivée : `statut === "disponible"`. */
  disponible: boolean;
  statut: StatutVehicule;
  marque: string;
  modele: string;
  annee: number | null;
  kilometrage: number | null;
  carburant: string;
  prix: number | null;
  created_at: string;
  updated_at: string | null;
};

export type StockVehiculeInput = {
  donnees: Record<string, string>;
  colonnes_pdf: string[];
  disponible?: boolean;
  statut?: StatutVehicule;
};

/**
 * Données saisies dans le modal Ajout / Édition.
 * Tous les champs sont en string pour simplifier le binding du formulaire ;
 * la conversion vers numeric se fait au moment de la persistance.
 */
export type VehiculeFormInput = {
  marque: string;
  modele: string;
  immatriculation: string;
  vin: string;
  annee: string;
  premiereCirculation: string;
  kilometrage: string;
  carburant: string;
  prix: string;
  statut: StatutVehicule;
  notes: string;
};

const STOCK_COLUMNS =
  "id, concession_id, donnees, colonnes_pdf, disponible, created_at, updated_at, statut, marque, modele, version, annee, couleur, kilometrage, prix, vin, puissance, co2, carburant, transmission, premiere_circulation";

/* -------------------------------------------------------------------------- */
/*                              Cell normalisation                            */
/* -------------------------------------------------------------------------- */

/** Convertit une cellule brute en string normalisée (gère Date, number, null). */
export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const dd = String(value.getDate()).padStart(2, "0");
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const yyyy = value.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function normalizeDonnees(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    out[k] = stringifyCell(v);
  }
  return out;
}

function normalizeColonnes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function normalizeStatut(value: unknown, disponible: boolean | undefined): StatutVehicule {
  if (value === "disponible" || value === "réservé" || value === "vendu") return value;
  // Pas de statut explicite (ligne créée avant la migration) : on dérive du
  // booléen `disponible` historique.
  return disponible === false ? "vendu" : "disponible";
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toIntLooseOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  // Tolère "120 000", "120000 km", etc.
  const digits = String(value).replace(/[^\d-]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

type LegacyStockRow = {
  id?: unknown;
  concession_id?: unknown;
  donnees?: unknown;
  colonnes_pdf?: unknown;
  disponible?: unknown;
  statut?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  // Colonnes typées (legacy + V2.1) : utilisées en lecture pour reconstruire
  // `donnees` côté lignes pré-V2 et pour alimenter les colonnes du tableau.
  marque?: unknown;
  modele?: unknown;
  version?: unknown;
  annee?: unknown;
  couleur?: unknown;
  kilometrage?: unknown;
  prix?: unknown;
  vin?: unknown;
  puissance?: unknown;
  co2?: unknown;
  carburant?: unknown;
  transmission?: unknown;
  premiere_circulation?: unknown;
};

/**
 * Backward-compat : pour les anciennes lignes (donnees vide), on reconstruit
 * un dictionnaire depuis les colonnes typées encore en base.
 */
function buildLegacyDonnees(row: LegacyStockRow): Record<string, string> {
  const legacyMap: Record<string, unknown> = {
    Marque: row.marque,
    Modèle: row.modele,
    Version: row.version,
    Année: row.annee,
    Couleur: row.couleur,
    Kilométrage: row.kilometrage,
    Prix: row.prix,
    VIN: row.vin,
    Puissance: row.puissance,
    CO2: row.co2,
    Carburant: row.carburant,
    Transmission: row.transmission,
    "Première circulation": row.premiere_circulation,
  };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(legacyMap)) {
    const s = stringifyCell(v);
    if (s) out[k] = s;
  }
  return out;
}

function normalizeRow(row: LegacyStockRow | null | undefined): StockVehicule {
  const donneesRaw = normalizeDonnees(row?.donnees);
  const donnees =
    Object.keys(donneesRaw).length > 0 ? donneesRaw : buildLegacyDonnees(row ?? {});
  const colonnesRaw = normalizeColonnes(row?.colonnes_pdf);
  const colonnes_pdf = colonnesRaw.length > 0 ? colonnesRaw : Object.keys(donnees);
  const dispoBoolRaw = typeof row?.disponible === "boolean" ? row.disponible : undefined;
  const statut = normalizeStatut(row?.statut, dispoBoolRaw);

  return {
    id: String(row?.id ?? ""),
    concession_id: (row?.concession_id as string | null | undefined) ?? null,
    donnees,
    colonnes_pdf,
    disponible: statut === "disponible",
    statut,
    marque: stringifyCell(row?.marque),
    modele: stringifyCell(row?.modele),
    annee: toIntOrNull(row?.annee),
    kilometrage: toIntOrNull(row?.kilometrage),
    carburant: stringifyCell(row?.carburant),
    prix: toNumberOrNull(row?.prix),
    created_at:
      typeof row?.created_at === "string" ? row.created_at : new Date().toISOString(),
    updated_at: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   CRUD                                     */
/* -------------------------------------------------------------------------- */

export async function loadStockVehicules(concessionId: string): Promise<StockVehicule[]> {
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("stock_vehicules")
    .select(STOCK_COLUMNS)
    .eq("concession_id", concessionId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("loadStockVehicules:", error);
    return [];
  }
  return (data ?? []).map((row) => normalizeRow(row as LegacyStockRow));
}

export async function getVehicule(id: string): Promise<StockVehicule | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("stock_vehicules")
    .select(STOCK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getVehicule:", error);
    return null;
  }
  if (!data) return null;
  return normalizeRow(data as LegacyStockRow);
}

export async function importVehicules(
  concessionId: string,
  vehicules: StockVehiculeInput[],
): Promise<StockVehicule[]> {
  if (!concessionId || vehicules.length === 0) return [];

  // Vérifie qu'on a bien un access_token : sans session, l'INSERT est rejeté
  // par la policy RLS `auth.uid() = concession_id` avec un message peu clair.
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session?.access_token) {
    throw new Error(
      "Session expirée. Reconnectez-vous avant de relancer l'import.",
    );
  }

  const payload = vehicules.map((v) => {
    const statut: StatutVehicule = v.statut ?? (v.disponible === false ? "vendu" : "disponible");
    const typed = extractTypedFieldsFromDonnees(v.donnees ?? {});
    return {
      concession_id: concessionId,
      donnees: v.donnees ?? {},
      colonnes_pdf: v.colonnes_pdf ?? [],
      disponible: statut === "disponible",
      statut,
      marque: typed.marque || null,
      modele: typed.modele || null,
      annee: typed.annee,
      kilometrage: typed.kilometrage,
      carburant: typed.carburant || null,
      prix: typed.prix,
      vin: typed.vin || null,
      premiere_circulation: typed.premiereCirculation || null,
    };
  });
  const { data, error } = await supabase
    .from("stock_vehicules")
    .insert(payload)
    .select(STOCK_COLUMNS);
  if (error) {
    console.error("importVehicules:", error);
    // On reconstruit un Error lisible (le toast affichera err.message).
    const parts = [error.message, error.details, error.hint].filter(Boolean);
    const reason = parts.join(" — ") || "Erreur Supabase inconnue.";
    throw new Error(`Import refusé : ${reason}`);
  }
  return (data ?? []).map((row) => normalizeRow(row as LegacyStockRow));
}

/**
 * Insère un véhicule saisi manuellement via le modal "Ajouter un véhicule".
 * On dérive automatiquement `donnees` + `colonnes_pdf` à partir des champs
 * remplis pour rester compatible avec le pipeline du bon de commande.
 */
export async function addVehicule(
  concessionId: string,
  input: VehiculeFormInput,
): Promise<StockVehicule> {
  if (!concessionId) throw new Error("concessionId manquant.");
  const { donnees, colonnes_pdf } = buildDonneesAndColonnesFromInput(input);
  const statut = input.statut || "disponible";
  const payload = {
    concession_id: concessionId,
    donnees,
    colonnes_pdf,
    disponible: statut === "disponible",
    statut,
    marque: input.marque || null,
    modele: input.modele || null,
    annee: toIntOrNull(input.annee),
    kilometrage: toIntOrNull(input.kilometrage),
    carburant: input.carburant || null,
    prix: toNumberOrNull(input.prix),
    vin: input.vin || null,
    premiere_circulation: input.premiereCirculation || null,
  };
  const { data, error } = await supabase
    .from("stock_vehicules")
    .insert(payload)
    .select(STOCK_COLUMNS)
    .single();
  if (error) {
    console.error("addVehicule:", error);
    throw error;
  }
  return normalizeRow(data as LegacyStockRow);
}

/** Met à jour les champs édités via le modal. Renvoie la ligne normalisée. */
export async function updateVehicule(
  id: string,
  input: VehiculeFormInput,
): Promise<StockVehicule> {
  if (!id) throw new Error("id manquant.");
  const { donnees, colonnes_pdf } = buildDonneesAndColonnesFromInput(input);
  const statut = input.statut || "disponible";
  const payload = {
    donnees,
    colonnes_pdf,
    disponible: statut === "disponible",
    statut,
    marque: input.marque || null,
    modele: input.modele || null,
    annee: toIntOrNull(input.annee),
    kilometrage: toIntOrNull(input.kilometrage),
    carburant: input.carburant || null,
    prix: toNumberOrNull(input.prix),
    vin: input.vin || null,
    premiere_circulation: input.premiereCirculation || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from("stock_vehicules")
    .update(payload)
    .eq("id", id)
    .select(STOCK_COLUMNS)
    .single();
  if (error) {
    console.error("updateVehicule:", error);
    throw error;
  }
  return normalizeRow(data as LegacyStockRow);
}

/** Mise à jour ciblée du statut (utilisée par le dropdown inline du tableau). */
export async function updateStatut(id: string, statut: StatutVehicule): Promise<void> {
  if (!id) return;
  const { error } = await supabase
    .from("stock_vehicules")
    .update({
      statut,
      disponible: statut === "disponible",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("updateStatut:", error);
    throw error;
  }
}

export async function deleteVehicule(id: string): Promise<void> {
  if (!id) return;
  const { error } = await supabase.from("stock_vehicules").delete().eq("id", id);
  if (error) {
    console.error("deleteVehicule:", error);
    throw error;
  }
}

/** @deprecated remplacé par `updateStatut(id, "vendu")`. Conservé pour compat. */
export async function markAsSold(id: string): Promise<void> {
  await updateStatut(id, "vendu");
}

/**
 * Marque un véhicule du stock comme vendu après un bon de commande.
 * Filtre par `concession_id = auth.uid()` (défense en profondeur + RLS).
 * Renvoie `false` si aucune ligne n'a été mise à jour (id invalide / autre concession).
 */
export async function markVehiculeVenduPourBon(vehiculeId: string): Promise<boolean> {
  const uid = await getCurrentUserId();
  if (!uid || !vehiculeId) return false;
  const { data, error } = await supabase
    .from("stock_vehicules")
    .update({
      statut: "vendu",
      disponible: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", vehiculeId)
    .eq("concession_id", uid)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("markVehiculeVenduPourBon:", error);
    return false;
  }
  if (!data) return false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_stock_updated"));
  }
  return true;
}

export async function clearStock(concessionId: string): Promise<void> {
  if (!concessionId) return;
  const { error } = await supabase
    .from("stock_vehicules")
    .delete()
    .eq("concession_id", concessionId);
  if (error) {
    console.error("clearStock:", error);
    throw error;
  }
}

/**
 * Recherche full-text client-side : on charge tout le stock de la concession
 * puis on filtre en JS sur l'ensemble des valeurs du JSONB. Utilisé par la
 * combobox stock dans le formulaire de bon de commande (filtre `disponible`
 * appliqué).
 */
export async function searchVehicules(
  concessionId: string,
  query: string,
): Promise<StockVehicule[]> {
  if (!concessionId) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await loadStockVehicules(concessionId);
  const tokens = q.split(/\s+/).filter(Boolean);
  return all
    .filter((v) => {
      if (v.statut !== "disponible") return false;
      const hay = [
        v.marque,
        v.modele,
        v.carburant,
        ...Object.values(v.donnees),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/*                              Helpers UI                                    */
/* -------------------------------------------------------------------------- */

/**
 * Label court pour une ligne de suggestion / une card. On préfère
 * "Marque Modèle" si renseignés, sinon on retombe sur les 3 premières
 * valeurs non vides de `donnees` (heuristique inchangée pour les lignes
 * importées en CSV sans structure).
 *
 * La signature est volontairement large : utilisable avec un véhicule
 * complet ou un snapshot partiel reconstruit côté formulaire.
 */
export function vehiculeDisplayLabel(v: {
  marque?: string;
  modele?: string;
  donnees: Record<string, string>;
  colonnes_pdf: string[];
}): string {
  const titled = [v.marque, v.modele].map((s) => (s ?? "").trim()).filter(Boolean);
  if (titled.length > 0) return titled.join(" ");
  const order = v.colonnes_pdf.length > 0 ? v.colonnes_pdf : Object.keys(v.donnees);
  const values = order
    .map((k) => (v.donnees[k] ?? "").trim())
    .filter((s) => s.length > 0);
  return values.slice(0, 3).join(" · ") || "(Véhicule sans titre)";
}

/**
 * Heuristique pour deviner le prix quand on sélectionne un véhicule depuis
 * un import CSV qui n'a pas de colonne typée `prix`. On retourne `""` si
 * rien n'est trouvé (le commercial saisit à la main dans la section Règlement).
 */
const PRIX_HINT_RE = /prix|price|tarif|montant|cost/i;
export function guessPrixFromDonnees(donnees: Record<string, string>): string {
  for (const [k, v] of Object.entries(donnees)) {
    if (!v) continue;
    if (PRIX_HINT_RE.test(k)) return v;
  }
  return "";
}

/** Retourne le prix prêt à injecter dans le bon de commande (numérique ou guess). */
export function vehiculePrixForBon(v: StockVehicule): string {
  if (typeof v.prix === "number" && Number.isFinite(v.prix)) {
    return String(v.prix);
  }
  return guessPrixFromDonnees(v.donnees);
}

function extractTypedFieldsFromDonnees(donnees: Record<string, string>): {
  marque: string;
  modele: string;
  annee: number | null;
  kilometrage: number | null;
  carburant: string;
  prix: number | null;
  vin: string;
  premiereCirculation: string;
} {
  const marque = findFromDonnees(donnees, ["Marque", "marque", "MARQUE"]);
  const modele = findFromDonnees(donnees, ["Modèle", "Modele", "modele", "MODELE", "Véhicule"]);
  const anneeRaw = findFromDonnees(donnees, ["Année", "Annee", "année", "annee", "ANNEE"]);
  const kilometrageRaw = findFromDonnees(donnees, [
    "Kilométrage",
    "Kilometrage",
    "kilometrage",
    "Km",
    "KM",
    "km",
  ]);
  const carburant = findFromDonnees(donnees, [
    "Carburant",
    "carburant",
    "Énergie",
    "Energie",
    "energie",
  ]);
  const prix = toNumberOrNull(guessPrixFromDonnees(donnees));
  const vin = findFromDonnees(donnees, KEY_HINTS.vin);
  const premiereCirculation = findFromDonnees(donnees, KEY_HINTS.premiereCirculation);

  return {
    marque,
    modele,
    annee: toIntLooseOrNull(anneeRaw),
    kilometrage: toIntLooseOrNull(kilometrageRaw),
    carburant,
    prix,
    vin,
    premiereCirculation,
  };
}

/* ------------------------- Form input <-> Vehicule ------------------------ */

const KEY_HINTS = {
  immatriculation: ["Immatriculation", "Immat", "Plaque", "immatriculation", "immat"],
  vin: ["VIN", "Vin", "vin", "Châssis", "Chassis"],
  premiereCirculation: [
    "Première circulation",
    "Première mise en circulation",
    "Premiere circulation",
    "1ère circulation",
    "MEC",
  ],
  notes: ["Notes", "Note", "Commentaire", "Remarques"],
};

function findFromDonnees(donnees: Record<string, string>, candidates: string[]): string {
  for (const c of candidates) {
    const v = donnees[c];
    if (v && v.trim()) return v;
  }
  // Fallback insensible à la casse / aux espaces / accents.
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  const normCandidates = candidates.map(norm);
  for (const [k, v] of Object.entries(donnees)) {
    if (!v || !v.trim()) continue;
    if (normCandidates.includes(norm(k))) return v;
  }
  return "";
}

/** Reconstitue un `VehiculeFormInput` à partir d'une ligne stock pour l'édition. */
export function formInputFromVehicule(v: StockVehicule): VehiculeFormInput {
  return {
    marque: v.marque || findFromDonnees(v.donnees, ["Marque", "marque", "MARQUE"]),
    modele:
      v.modele || findFromDonnees(v.donnees, ["Modèle", "Modele", "modele", "MODELE"]),
    immatriculation: findFromDonnees(v.donnees, KEY_HINTS.immatriculation),
    vin: findFromDonnees(v.donnees, KEY_HINTS.vin),
    annee: v.annee !== null ? String(v.annee) : findFromDonnees(v.donnees, ["Année", "Annee"]),
    premiereCirculation: findFromDonnees(v.donnees, KEY_HINTS.premiereCirculation),
    kilometrage:
      v.kilometrage !== null
        ? String(v.kilometrage)
        : findFromDonnees(v.donnees, ["Kilométrage", "Kilometrage", "Km"]),
    carburant:
      v.carburant || findFromDonnees(v.donnees, ["Carburant", "carburant"]),
    prix:
      v.prix !== null
        ? String(v.prix)
        : guessPrixFromDonnees(v.donnees),
    statut: v.statut,
    notes: findFromDonnees(v.donnees, KEY_HINTS.notes),
  };
}

/**
 * Construit un dictionnaire `donnees` + son ordre `colonnes_pdf` à partir
 * des champs saisis dans le modal. Seules les valeurs non vides sont
 * incluses, dans un ordre stable pour le PDF. Les notes internes ne sont
 * **pas** publiées dans `colonnes_pdf` (donc absentes du PDF) mais sont
 * conservées dans `donnees` à des fins internes.
 */
function buildDonneesAndColonnesFromInput(input: VehiculeFormInput): {
  donnees: Record<string, string>;
  colonnes_pdf: string[];
} {
  const ordered: [string, string][] = [];
  const push = (key: string, value: string) => {
    const trimmed = (value ?? "").trim();
    if (trimmed) ordered.push([key, trimmed]);
  };
  push("Marque", input.marque);
  push("Modèle", input.modele);
  push("Immatriculation", input.immatriculation.toUpperCase());
  push("VIN", input.vin);
  push("Année", input.annee);
  push("Première circulation", input.premiereCirculation);
  push("Kilométrage", input.kilometrage);
  push("Carburant", input.carburant);
  push("Prix", input.prix);

  const donnees: Record<string, string> = Object.fromEntries(ordered);
  const notes = (input.notes ?? "").trim();
  if (notes) donnees["Notes"] = notes;

  return { donnees, colonnes_pdf: ordered.map(([k]) => k) };
}

export const STATUT_LABELS: Record<StatutVehicule, string> = {
  disponible: "Disponible",
  réservé: "Réservé",
  vendu: "Vendu",
};

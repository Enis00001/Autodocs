import { supabase } from "@/lib/supabase";

/**
 * V2 — schéma libre. Un véhicule en stock est juste un sac de clé/valeur issu
 * directement du fichier CSV/Excel, sans mapping vers des champs standards.
 *
 * - `donnees` : paires clé/valeur (clé = nom de colonne du fichier source)
 * - `colonnes_pdf` : liste ordonnée des clés à afficher dans le PDF / le form
 *
 * L'ancienne liste typée (marque, modele, prix…) est abandonnée pour simplifier
 * le flux d'import et laisser le commercial utiliser le vocabulaire de son
 * propre ERP / fichier.
 */
export type StockVehicule = {
  id: string;
  concession_id: string | null;
  donnees: Record<string, string>;
  colonnes_pdf: string[];
  disponible: boolean;
  created_at: string;
};

export type StockVehiculeInput = {
  donnees: Record<string, string>;
  colonnes_pdf: string[];
  disponible?: boolean;
};

const STOCK_COLUMNS =
  "id, concession_id, donnees, colonnes_pdf, disponible, created_at, marque, modele, version, annee, couleur, kilometrage, prix, vin, puissance, co2, carburant, transmission, premiere_circulation";

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

type LegacyStockRow = {
  id?: unknown;
  concession_id?: unknown;
  donnees?: unknown;
  colonnes_pdf?: unknown;
  disponible?: unknown;
  created_at?: unknown;
  // Anciennes colonnes typées : utilisées uniquement en lecture pour
  // reconstruire `donnees` sur les lignes importées avant la V2.
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
  const colonnes_pdf =
    colonnesRaw.length > 0 ? colonnesRaw : Object.keys(donnees);
  return {
    id: String(row?.id ?? ""),
    concession_id: (row?.concession_id as string | null | undefined) ?? null,
    donnees,
    colonnes_pdf,
    disponible: typeof row?.disponible === "boolean" ? row.disponible : true,
    created_at:
      typeof row?.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*                                   CRUD                                     */
/* -------------------------------------------------------------------------- */

export async function loadStockVehicules(concessionId: string): Promise<StockVehicule[]> {
  if (!concessionId) return [];
  console.log("Tentative sauvegarde: loadStockVehicules (select stock_vehicules)");
  const { data, error } = await supabase
    .from("stock_vehicules")
    .select(STOCK_COLUMNS)
    .eq("concession_id", concessionId)
    .order("created_at", { ascending: false });
  console.log("Résultat Supabase:", { data, error });
  if (error) {
    console.error("loadStockVehicules:", error);
    return [];
  }
  return (data ?? []).map((row) => normalizeRow(row as LegacyStockRow));
}

export async function importVehicules(
  concessionId: string,
  vehicules: StockVehiculeInput[],
): Promise<StockVehicule[]> {
  if (!concessionId || vehicules.length === 0) return [];
  const payload = vehicules.map((v) => ({
    concession_id: concessionId,
    donnees: v.donnees ?? {},
    colonnes_pdf: v.colonnes_pdf ?? [],
    disponible: v.disponible ?? true,
  }));
  console.log("Tentative sauvegarde: importVehicules", { count: payload.length });
  const { data, error } = await supabase
    .from("stock_vehicules")
    .insert(payload)
    .select(STOCK_COLUMNS);
  console.log("Résultat Supabase:", { data, error });
  if (error) {
    console.error("importVehicules:", error);
    throw error;
  }
  return (data ?? []).map((row) => normalizeRow(row as LegacyStockRow));
}

export async function deleteVehicule(id: string): Promise<void> {
  if (!id) return;
  console.log("Tentative sauvegarde: deleteVehicule", { id });
  const { error } = await supabase.from("stock_vehicules").delete().eq("id", id);
  console.log("Résultat Supabase:", { error });
  if (error) {
    console.error("deleteVehicule:", error);
    throw error;
  }
}

export async function markAsSold(id: string): Promise<void> {
  if (!id) return;
  console.log("Tentative sauvegarde: markAsSold", { id });
  const { error } = await supabase
    .from("stock_vehicules")
    .update({ disponible: false })
    .eq("id", id);
  console.log("Résultat Supabase:", { error });
  if (error) {
    console.error("markAsSold:", error);
    throw error;
  }
}

export async function clearStock(concessionId: string): Promise<void> {
  if (!concessionId) return;
  console.log("Tentative sauvegarde: clearStock", { concessionId });
  const { error } = await supabase
    .from("stock_vehicules")
    .delete()
    .eq("concession_id", concessionId);
  console.log("Résultat Supabase:", { error });
  if (error) {
    console.error("clearStock:", error);
    throw error;
  }
}

/**
 * Recherche full-text client-side : on charge tout le stock disponible de la
 * concession puis on filtre en JS sur l'ensemble des valeurs du JSONB. Plus
 * simple à raisonner et largement suffisant jusqu'à ~1000 véhicules.
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
      if (!v.disponible) return false;
      const hay = Object.values(v.donnees).join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/*                              Helpers UI                                    */
/* -------------------------------------------------------------------------- */

/**
 * Label court pour une ligne de suggestion / une card. On concatène les 3
 * premières valeurs non vides dans l'ordre de `colonnes_pdf` (ou dans l'ordre
 * d'insertion si `colonnes_pdf` est vide) — c'est une heuristique raisonnable
 * quand on ne connaît pas la sémantique des colonnes.
 */
export function vehiculeDisplayLabel(v: StockVehicule): string {
  const order = v.colonnes_pdf.length > 0 ? v.colonnes_pdf : Object.keys(v.donnees);
  const values = order
    .map((k) => (v.donnees[k] ?? "").trim())
    .filter((s) => s.length > 0);
  return values.slice(0, 3).join(" · ") || "(Véhicule sans titre)";
}

/**
 * Heuristique pour deviner le prix quand on sélectionne un véhicule : on
 * cherche une clé dont le nom normalisé contient "prix", "price", "tarif" ou
 * "montant". Retourne `""` si rien n'est trouvé (le commercial saisit à la
 * main dans la section Règlement).
 */
const PRIX_HINT_RE = /prix|price|tarif|montant|cost/i;
export function guessPrixFromDonnees(donnees: Record<string, string>): string {
  for (const [k, v] of Object.entries(donnees)) {
    if (!v) continue;
    if (PRIX_HINT_RE.test(k)) return v;
  }
  return "";
}

import { supabase } from "@/lib/supabase";

export type StockVehicule = {
  id: string;
  concession_id: string | null;
  marque: string;
  modele: string;
  version: string;
  annee: string;
  couleur: string;
  kilometrage: string;
  prix: string;
  vin: string;
  puissance: string;
  co2: string;
  carburant: string;
  transmission: string;
  premiere_circulation: string;
  disponible: boolean;
  /**
   * Liste des champs standards à afficher dans le PDF bon de commande.
   * Valeurs autorisées = clés de type `StockField`. Vide ou null => on affiche
   * les champs par défaut (backward-compat pour les véhicules importés avant
   * l'introduction du toggle).
   */
  colonnes_pdf: string[];
  created_at: string;
};

/** Un véhicule à importer : mêmes clés que StockVehicule, sauf id/concession_id/created_at. */
export type StockVehiculeInput = Partial<
  Omit<StockVehicule, "id" | "concession_id" | "created_at" | "disponible">
> & { disponible?: boolean };

const STOCK_COLUMNS =
  "id, concession_id, marque, modele, version, annee, couleur, kilometrage, prix, vin, puissance, co2, carburant, transmission, premiere_circulation, disponible, colonnes_pdf, created_at";

function normalizeRow(row: Partial<StockVehicule> | null | undefined): StockVehicule {
  const rawColonnes = (row as { colonnes_pdf?: unknown } | null | undefined)?.colonnes_pdf;
  const colonnes_pdf = Array.isArray(rawColonnes)
    ? rawColonnes.filter((x): x is string => typeof x === "string")
    : [];
  return {
    id: String(row?.id ?? ""),
    concession_id: row?.concession_id ?? null,
    marque: row?.marque ?? "",
    modele: row?.modele ?? "",
    version: row?.version ?? "",
    annee: row?.annee ?? "",
    couleur: row?.couleur ?? "",
    kilometrage: row?.kilometrage ?? "",
    prix: row?.prix ?? "",
    vin: row?.vin ?? "",
    puissance: row?.puissance ?? "",
    co2: row?.co2 ?? "",
    carburant: row?.carburant ?? "",
    transmission: row?.transmission ?? "",
    premiere_circulation: row?.premiere_circulation ?? "",
    disponible: row?.disponible ?? true,
    colonnes_pdf,
    created_at: row?.created_at ?? new Date().toISOString(),
  };
}

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
  return (data ?? []).map((row) => normalizeRow(row as Partial<StockVehicule>));
}

export async function importVehicules(
  concessionId: string,
  vehicules: StockVehiculeInput[],
  colonnesPdf: string[] = [],
): Promise<StockVehicule[]> {
  if (!concessionId || vehicules.length === 0) return [];
  const payload = vehicules.map((v) => ({
    concession_id: concessionId,
    marque: v.marque ?? "",
    modele: v.modele ?? "",
    version: v.version ?? "",
    annee: v.annee ?? "",
    couleur: v.couleur ?? "",
    kilometrage: v.kilometrage ?? "",
    prix: v.prix ?? "",
    vin: v.vin ?? "",
    puissance: v.puissance ?? "",
    co2: v.co2 ?? "",
    carburant: v.carburant ?? "",
    transmission: v.transmission ?? "",
    premiere_circulation: v.premiere_circulation ?? "",
    disponible: v.disponible ?? true,
    colonnes_pdf: colonnesPdf,
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
  return (data ?? []).map((row) => normalizeRow(row as Partial<StockVehicule>));
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

/** Recherche insensible à la casse sur marque + modele + version. Ne renvoie que les véhicules disponibles. */
export async function searchVehicules(
  concessionId: string,
  query: string,
): Promise<StockVehicule[]> {
  if (!concessionId) return [];
  const q = query.trim();
  if (!q) return [];
  // Supabase `.or()` avec ilike — on échappe les virgules pour éviter de casser la syntaxe.
  const safe = q.replace(/[%,]/g, " ").trim();
  const pattern = `%${safe}%`;
  const orExpr = `marque.ilike.${pattern},modele.ilike.${pattern},version.ilike.${pattern}`;
  console.log("Tentative sauvegarde: searchVehicules", { q: safe });
  const { data, error } = await supabase
    .from("stock_vehicules")
    .select(STOCK_COLUMNS)
    .eq("concession_id", concessionId)
    .eq("disponible", true)
    .or(orExpr)
    .order("marque", { ascending: true })
    .limit(20);
  console.log("Résultat Supabase:", { data, error });
  if (error) {
    console.error("searchVehicules:", error);
    return [];
  }
  return (data ?? []).map((row) => normalizeRow(row as Partial<StockVehicule>));
}

/* -------------------------------------------------------------------------- */
/*                Détection automatique des colonnes à l'import               */
/* -------------------------------------------------------------------------- */

export type StockField = keyof Omit<
  StockVehicule,
  "id" | "concession_id" | "created_at" | "disponible" | "colonnes_pdf"
>;

/** Liste ordonnée et typée des champs standards. */
export const STOCK_FIELDS: StockField[] = [
  "marque",
  "modele",
  "version",
  "annee",
  "prix",
  "kilometrage",
  "couleur",
  "vin",
  "puissance",
  "co2",
  "carburant",
  "transmission",
  "premiere_circulation",
];

export const STOCK_FIELD_LABELS: Record<StockField, string> = {
  marque: "Marque",
  modele: "Modèle",
  version: "Version",
  annee: "Année",
  couleur: "Couleur",
  kilometrage: "Kilométrage",
  prix: "Prix",
  vin: "VIN",
  puissance: "Puissance",
  co2: "CO₂",
  carburant: "Carburant",
  transmission: "Transmission",
  premiere_circulation: "1ère circulation",
};

/**
 * Champs affichés par défaut dans le form NouveauBon + PDF quand aucun
 * véhicule du stock n'est sélectionné (ou quand `colonnes_pdf` est vide).
 * On garde les 8 champs historiques du formulaire — sans `annee`, `carburant`,
 * `transmission`, `marque` et `version` qui sont "nouveaux" dans ce flow.
 */
export const DEFAULT_PDF_FIELDS: StockField[] = [
  "modele",
  "prix",
  "vin",
  "kilometrage",
  "couleur",
  "puissance",
  "co2",
  "premiere_circulation",
];

/** Synonymes / mots-clés (normalisés) à rechercher dans les en-têtes. */
const COLUMN_SYNONYMS: Record<StockField, string[]> = {
  marque: ["marque", "make", "brand", "manufacturer", "constructeur"],
  modele: ["modele", "model"],
  version: ["version", "finition", "trim", "pack"],
  annee: ["annee", "year", "annee modele"],
  couleur: ["couleur", "color", "colour", "teinte"],
  kilometrage: ["kilometrage", "km", "kilometres", "kilometers", "mileage", "odometre"],
  prix: ["prix", "price", "tarif", "montant", "cost"],
  vin: ["vin", "chassis", "numero de chassis", "numserie", "numero de serie"],
  puissance: ["puissance", "chevaux", "cv", "horsepower", "hp", "kw"],
  co2: ["co2", "emission co2", "emissions co2"],
  carburant: ["carburant", "fuel", "energie", "energy", "essence", "diesel"],
  transmission: ["transmission", "boite", "boite de vitesse", "gearbox", "bv"],
  premiere_circulation: [
    "premiere circulation",
    "1ere circulation",
    "1re circulation",
    "mec",
    "mise en circulation",
    "date mec",
    "first registration",
  ],
};

function normalizeHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cherche, pour chaque champ cible, la meilleure colonne source (en comparant
 * les en-têtes normalisés à la liste de synonymes). Renvoie un mapping
 * `{ champCible: entêteSource }`.
 */
export function detectColumnMapping(headers: string[]): Partial<Record<StockField, string>> {
  const mapping: Partial<Record<StockField, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  for (const field of Object.keys(COLUMN_SYNONYMS) as StockField[]) {
    const synonyms = COLUMN_SYNONYMS[field];
    // 1) Correspondance exacte
    const exact = normalized.find((h) => synonyms.includes(h.norm));
    if (exact) {
      mapping[field] = exact.raw;
      continue;
    }
    // 2) Correspondance partielle (contient)
    const partial = normalized.find((h) =>
      synonyms.some((s) => h.norm.includes(s) || s.includes(h.norm)),
    );
    if (partial) {
      mapping[field] = partial.raw;
    }
  }
  return mapping;
}

/** Convertit une cellule brute en string normalisée (gère Date, number, undefined). */
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

/**
 * Applique le mapping détecté à une ligne brute (objet {entête: valeur}) et
 * produit un `StockVehiculeInput` prêt à être inséré.
 */
export function mapRowToVehicule(
  row: Record<string, unknown>,
  mapping: Partial<Record<StockField, string>>,
): StockVehiculeInput {
  const v: StockVehiculeInput = {};
  for (const field of Object.keys(mapping) as StockField[]) {
    const sourceHeader = mapping[field];
    if (!sourceHeader) continue;
    v[field] = stringifyCell(row[sourceHeader]);
  }
  return v;
}

/** Libellé court pour afficher un véhicule dans une liste / suggestion. */
export function vehiculeLabel(v: Pick<StockVehicule, "marque" | "modele" | "version">): string {
  return [v.marque, v.modele, v.version].map((s) => (s || "").trim()).filter(Boolean).join(" ");
}

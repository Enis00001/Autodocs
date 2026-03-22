import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

const LOCAL_STORAGE_KEY = "autodocs_vendeurs";
const MIGRATION_FLAG_KEY = "autodocs_migrated_vendeurs_v1";

export type Vendeur = {
  id: string;
  nom: string;
  prenom: string;
  dateAjout: string;
};

type VendeurRow = {
  id: string;
  nom: string;
  prenom: string;
  date_ajout: string;
};

function rowToVendeur(row: VendeurRow): Vendeur {
  return {
    id: row.id,
    nom: row.nom ?? "",
    prenom: row.prenom ?? "",
    dateAjout: row.date_ajout ?? new Date().toISOString(),
  };
}

function vendeurToRow(v: Vendeur) {
  return {
    id: v.id,
    nom: v.nom,
    prenom: v.prenom,
    date_ajout: v.dateAjout,
  };
}

function readLocalVendeurs(): Vendeur[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v) =>
        v &&
        typeof v === "object" &&
        typeof (v as any).id === "string" &&
        typeof (v as any).nom === "string" &&
        typeof (v as any).prenom === "string" &&
        typeof (v as any).dateAjout === "string"
    ) as Vendeur[];
  } catch {
    return [];
  }
}

function getMigrationFlag(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(MIGRATION_FLAG_KEY) === "1";
}

function setMigrationFlag(): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MIGRATION_FLAG_KEY, "1");
}

export async function loadVendeurs(): Promise<Vendeur[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  console.log("Tentative sauvegarde: loadVendeurs (select vendeurs)");
  const { data, error } = await supabase
    .from("vendeurs")
    .select("id, nom, prenom, date_ajout")
    .eq("user_id", userId)
    .order("date_ajout", { ascending: false });
  console.log("Résultat Supabase:", { data, error });

  if (error) {
    console.error("loadVendeurs:", error);
    return [];
  }

  const rows = (data ?? []) as VendeurRow[];

  // Migration one-shot depuis localStorage (même si la table n'est pas vide)
  const local = readLocalVendeurs();
  const shouldMigrate = local.length > 0 && !getMigrationFlag();
  if (shouldMigrate) {
    const toUpsert = local.map((v) => ({ ...vendeurToRow(v), user_id: userId }));
    console.log("Tentative sauvegarde: loadVendeurs migration", { data: toUpsert });
    const migResult = await supabase
      .from("vendeurs")
      .upsert(toUpsert, { onConflict: "id" });
    console.log("Résultat Supabase:", { data: migResult.data, error: migResult.error });
    if (migResult.error) console.error("loadVendeurs migration:", migResult.error);
    setMigrationFlag();

    console.log("Tentative sauvegarde: loadVendeurs (select after migration)");
    const { data: dataAfter, error: errAfter } = await supabase
      .from("vendeurs")
      .select("id, nom, prenom, date_ajout")
      .eq("user_id", userId)
      .order("date_ajout", { ascending: false });
    console.log("Résultat Supabase:", { data: dataAfter, error: errAfter });
    return ((dataAfter ?? []) as VendeurRow[]).map(rowToVendeur);
  }

  return rows.map(rowToVendeur);
}

/** Insère (ou met à jour) un vendeur dans Supabase. */
export async function saveVendeur(vendeur: Vendeur): Promise<Vendeur> {
  const userId = await getCurrentUserId();
  if (!userId) return vendeur;
  const row = vendeurToRow(vendeur);
  const payload = { ...row, user_id: userId };
  console.log("Tentative sauvegarde: saveVendeur", { data: payload });
  const result = await supabase
    .from("vendeurs")
    .upsert(payload, { onConflict: "id" });
  console.log("Résultat Supabase:", { data: result.data, error: result.error });
  if (result.error) console.error("saveVendeur:", result.error);
  return vendeur;
}

/** Crée un vendeur avec ID + date d'ajout. */
export async function addVendeur(nom: string, prenom: string): Promise<Vendeur> {
  const vendeur: Vendeur = {
    id: crypto.randomUUID(),
    nom: (nom || "").trim(),
    prenom: (prenom || "").trim(),
    dateAjout: new Date().toISOString(),
  };
  await saveVendeur(vendeur);
  return vendeur;
}

export async function deleteVendeur(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  console.log("Tentative sauvegarde: deleteVendeur", { id });
  const result = await supabase.from("vendeurs").delete().eq("id", id).eq("user_id", userId).select();
  console.log("Résultat Supabase:", { data: result.data, error: result.error });
  if (result.error) console.error("deleteVendeur:", result.error);
}

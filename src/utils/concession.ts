import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

const LOCAL_STORAGE_KEY = "autodocs_concession";
const MIGRATION_FLAG_KEY = "autodocs_migrated_concession_v1";

export type ConcessionData = {
  name: string;
  address: string;
  logoBase64?: string;
};

const defaults: ConcessionData = {
  name: "Ma concession",
  address: "45 avenue de la République, 69001 Lyon",
};

type ConcessionRow = {
  id: string;
  nom: string;
  adresse: string;
  logo_base64: string | null;
};

function rowToConcession(row: ConcessionRow): ConcessionData {
  return {
    name: row.nom ?? defaults.name,
    address: row.adresse ?? defaults.address,
    logoBase64: row.logo_base64 ?? undefined,
  };
}

function readLocalConcession(): ConcessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConcessionData>;
    const name =
      typeof parsed.name === "string" && parsed.name.trim().length > 0
        ? parsed.name.trim()
        : defaults.name;
    const address =
      typeof parsed.address === "string" && parsed.address.trim().length > 0
        ? parsed.address.trim()
        : defaults.address;
    const logoBase64 =
      typeof parsed.logoBase64 === "string" ? parsed.logoBase64 : undefined;
    return { name, address, logoBase64 };
  } catch {
    return null;
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

export async function loadConcession(): Promise<ConcessionData> {
  const userId = await getCurrentUserId();
  if (!userId) return { ...defaults };
  console.log("Tentative sauvegarde: loadConcession (select)");
  const { data, error } = await supabase
    .from("concession")
    .select("id, nom, adresse, logo_base64")
    .eq("user_id", userId)
    .limit(1);
  console.log("Résultat Supabase:", { data, error });

  if (error) {
    console.error("loadConcession:", error);
    return { ...defaults };
  }

  const local = readLocalConcession();
  const shouldMigrate = local !== null && !getMigrationFlag();

  // Si Supabase a déjà une concession, on peut aussi la synchroniser avec le localStorage une seule fois.
  if (data && data.length > 0) {
    const existing = data[0] as ConcessionRow;
    if (shouldMigrate && local) {
      const payload = {
        nom: local.name,
        adresse: local.address,
        logo_base64: local.logoBase64 ?? null,
      };
      console.log("Tentative sauvegarde: loadConcession migration update", { data: payload });
      const upResult = await supabase
        .from("concession")
        .update(payload)
        .eq("id", existing.id)
        .eq("user_id", userId);
      console.log("Résultat Supabase:", { data: upResult.data, error: upResult.error });
      if (upResult.error) console.error("loadConcession migration update:", upResult.error);
      setMigrationFlag();
    }
    // Reload depuis DB pour être sûr d'avoir la valeur finale
    console.log("Tentative sauvegarde: loadConcession (select after update)");
    const { data: afterData, error: errAfter } = await supabase
      .from("concession")
      .select("id, nom, adresse, logo_base64")
      .eq("user_id", userId)
      .limit(1);
    console.log("Résultat Supabase:", { data: afterData, error: errAfter });
    if (afterData && afterData.length > 0) {
      return rowToConcession(afterData[0] as ConcessionRow);
    }
    return rowToConcession(existing);
  }

  // Supabase vide : migration depuis localStorage
  if (local) {
    const toInsert = {
      nom: local.name,
      adresse: local.address,
      logo_base64: local.logoBase64 ?? null,
      user_id: userId,
    };
    console.log("Tentative sauvegarde: loadConcession migration insert", { data: toInsert });
    const insResult = await supabase.from("concession").insert(toInsert);
    console.log("Résultat Supabase:", { data: insResult.data, error: insResult.error });
    if (insResult.error) console.error("loadConcession migration:", insResult.error);
    if (shouldMigrate) setMigrationFlag();
    return local;
  }

  // Supabase vide ET pas de localStorage : on bootstrap depuis les métadonnées Auth
  const { data: userData } = await supabase.auth.getUser();
  const metadataName =
    (userData.user?.user_metadata?.concession_name as string | undefined)?.trim() ?? "";
  const bootstrap: ConcessionData = {
    name: metadataName || "Ma concession",
    address: "",
  };
  const bootstrapInsert = {
    nom: bootstrap.name,
    adresse: bootstrap.address,
    logo_base64: null,
    user_id: userId,
  };
  console.log("Tentative sauvegarde: loadConcession bootstrap insert", { data: bootstrapInsert });
  const bootResult = await supabase.from("concession").insert(bootstrapInsert);
  console.log("Résultat Supabase:", { data: bootResult.data, error: bootResult.error });
  if (bootResult.error) console.error("loadConcession bootstrap:", bootResult.error);
  return bootstrap;
}

export async function saveConcession(data: ConcessionData): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  const payload = {
    nom: data.name,
    adresse: data.address,
    logo_base64: data.logoBase64 ?? null,
  };

  // Upsert "soft" : on considère qu'il n'y a qu'une concession (1 seule ligne).
  console.log("Tentative sauvegarde: saveConcession select existing");
  const { data: existing, error: selError } = await supabase
    .from("concession")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  console.log("Résultat Supabase:", { data: existing, error: selError });

  if (selError) console.error("saveConcession select existing:", selError);

  if (existing && existing.length > 0) {
    const id = (existing[0] as ConcessionRow).id;
    console.log("Tentative sauvegarde: saveConcession update", { data: payload, id });
    const upResult = await supabase
      .from("concession")
      .update(payload)
      .eq("id", id)
      .eq("user_id", userId);
    console.log("Résultat Supabase:", { data: upResult.data, error: upResult.error });
    if (upResult.error) console.error("saveConcession update:", upResult.error);
  } else {
    console.log("Tentative sauvegarde: saveConcession insert", { data: payload });
    const insResult = await supabase
      .from("concession")
      .insert({ ...payload, user_id: userId });
    console.log("Résultat Supabase:", { data: insResult.data, error: insResult.error });
    if (insResult.error) console.error("saveConcession insert:", insResult.error);
  }

  window.dispatchEvent(new CustomEvent("autodocs_concession_updated"));
}

/** Initiales pour le badge (2 lettres, ex. "Auto Dupont" → "AD"). */
export function getConcessionInitials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "AD";
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2)
    return (words[0][0] + words[1][0]).toUpperCase().slice(0, 2);
  return (trimmed.slice(0, 2) || "AD").toUpperCase();
}

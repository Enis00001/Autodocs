import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId } from "@/lib/auth";

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

/**
 * Charge la "vitrine" de la concession (nom + adresse courte + logo) — utilisée
 * par la sidebar et certaines vues PDF. La donnée est stockée dans la table
 * `concession` (singulier, héritée) qui a désormais une colonne `concession_id`.
 *
 * En l'absence de ligne, on fallback sur la nouvelle table `concessions`
 * (plurielle) pour récupérer au moins le nom.
 */
export async function loadConcession(): Promise<ConcessionData> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return { ...defaults };

  const { data, error } = await supabase
    .from("concession")
    .select("id, nom, adresse, logo_base64")
    .eq("concession_id", concessionId)
    .limit(1);

  if (error) {
    console.error("loadConcession:", error);
    return { ...defaults };
  }

  const local = readLocalConcession();
  const shouldMigrate = local !== null && !getMigrationFlag();

  if (data && data.length > 0) {
    const existing = data[0] as ConcessionRow;
    if (shouldMigrate && local) {
      const payload = {
        nom: local.name,
        adresse: local.address,
        logo_base64: local.logoBase64 ?? null,
      };
      const upResult = await supabase
        .from("concession")
        .update(payload)
        .eq("id", existing.id)
        .eq("concession_id", concessionId);
      if (upResult.error) console.error("loadConcession migration update:", upResult.error);
      setMigrationFlag();
    }
    const { data: afterData, error: errAfter } = await supabase
      .from("concession")
      .select("id, nom, adresse, logo_base64")
      .eq("concession_id", concessionId)
      .limit(1);
    if (errAfter) console.error("loadConcession reload:", errAfter);
    if (afterData && afterData.length > 0) {
      return rowToConcession(afterData[0] as ConcessionRow);
    }
    return rowToConcession(existing);
  }

  // Pas de ligne dans `concession` (singulier) : on essaie de bootstrap depuis
  // localStorage, sinon depuis la nouvelle table `concessions`.
  if (local) {
    const toInsert = {
      nom: local.name,
      adresse: local.address,
      logo_base64: local.logoBase64 ?? null,
      concession_id: concessionId,
    };
    const insResult = await supabase.from("concession").insert(toInsert);
    if (insResult.error) console.error("loadConcession migration insert:", insResult.error);
    if (shouldMigrate) setMigrationFlag();
    return local;
  }

  // Bootstrap depuis la nouvelle table `concessions` (= source de vérité).
  const { data: ccs } = await supabase
    .from("concessions")
    .select("nom, adresse, logo_url")
    .eq("id", concessionId)
    .maybeSingle();
  const bootstrap: ConcessionData = {
    name: (ccs?.nom as string | undefined)?.trim() || "Ma concession",
    address: (ccs?.adresse as string | undefined)?.trim() || "",
    logoBase64: (ccs?.logo_url as string | undefined) || undefined,
  };
  const bootstrapInsert = {
    nom: bootstrap.name,
    adresse: bootstrap.address,
    logo_base64: null,
    concession_id: concessionId,
  };
  const bootResult = await supabase.from("concession").insert(bootstrapInsert);
  if (bootResult.error) console.error("loadConcession bootstrap:", bootResult.error);
  return bootstrap;
}

export async function saveConcession(data: ConcessionData): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;
  const payload = {
    nom: data.name,
    adresse: data.address,
    logo_base64: data.logoBase64 ?? null,
  };

  // Upsert "soft" : on considère qu'il n'y a qu'une seule ligne par concession.
  const { data: existing, error: selError } = await supabase
    .from("concession")
    .select("id")
    .eq("concession_id", concessionId)
    .limit(1);

  if (selError) console.error("saveConcession select existing:", selError);

  if (existing && existing.length > 0) {
    const id = (existing[0] as ConcessionRow).id;
    const upResult = await supabase
      .from("concession")
      .update(payload)
      .eq("id", id)
      .eq("concession_id", concessionId);
    if (upResult.error) console.error("saveConcession update:", upResult.error);
  } else {
    const insResult = await supabase
      .from("concession")
      .insert({ ...payload, concession_id: concessionId });
    if (insResult.error) console.error("saveConcession insert:", insResult.error);
  }

  // Synchronise aussi le nom et le logo sur la table `concessions` (pluriel) :
  // c'est la source de vérité métier consultée par /api et l'invitation par email.
  const { error: ccsErr } = await supabase
    .from("concessions")
    .update({
      nom: data.name,
      adresse: data.address,
      logo_url: data.logoBase64 ?? null,
    })
    .eq("id", concessionId);
  if (ccsErr) console.error("saveConcession concessions sync:", ccsErr);

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

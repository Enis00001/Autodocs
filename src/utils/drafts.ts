import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

export type DocumentScannedState = {
  status: "ok" | "invalid" | "unreadable";
  detail: string;
  extractedData?: Record<string, string>;
};

/**
 * V1 simplifiée — 3 sections : Client / Véhicule (+ reprise optionnelle) / Règlement.
 * Les champs hérités (options, financement complexe, RIB, vendeur, templates…) ne
 * font plus partie du formulaire. Les colonnes DB correspondantes restent en place
 * (DEFAULT '') pour préserver les anciens brouillons.
 */
export type BonDraftData = {
  id: string;
  createdAt: string;
  updatedAt: string;

  // Section 1 — Client
  clientNom: string;
  clientPrenom: string;
  clientDateNaissance: string;
  clientNumeroCni: string;
  clientAdresse: string;

  // Section 2 — Véhicule (auto-rempli depuis stock)
  vehiculeModele: string;
  vehiculeVin: string;
  vehiculePremiereCirculation: string;
  vehiculeKilometrage: string;
  vehiculeCo2: string;
  vehiculeChevaux: string;
  vehiculeCouleur: string;
  vehiculePrix: string;

  // Section 2b — Reprise véhicule (toggle + formulaire manuel)
  repriseActive: boolean;
  reprisePlaque: string;
  repriseMarque: string;
  repriseModele: string;
  repriseVin: string;
  reprisePremiereCirculation: string;
  repriseValeur: string;

  // Section 3 — Règlement
  modePaiement: "comptant" | "financement";
  acompte: string;
  vehiculeRemise: string;
  vehiculeDateLivraison: string;

  // Scans de documents (CNI, etc.)
  documentsScanned: Record<string, DocumentScannedState>;
};

type BrouillonRow = {
  id: string;
  created_at: string;
  updated_at: string;
  client_nom: string;
  client_prenom: string;
  client_date_naissance: string;
  client_numero_cni: string;
  client_adresse: string;
  vehicule_modele: string;
  vehicule_vin: string;
  vehicule_premiere_circulation: string;
  vehicule_kilometrage: string;
  vehicule_co2: string;
  vehicule_chevaux: string;
  vehicule_couleur: string;
  vehicule_prix: string;
  vehicule_remise: string;
  vehicule_date_livraison: string;
  acompte: string;
  mode_paiement: string;
  documents_scanned: unknown;
  /**
   * JSONB libre. Utilisé en V1 pour stocker les champs reprise_* (pas de migration
   * DB nécessaire) : reprise_active, reprise_plaque, reprise_marque, reprise_modele,
   * reprise_vin, reprise_premiere_circulation, reprise_valeur.
   */
  vehicle_field_values: unknown;
};

function sanitizeScannedDocuments(value: unknown): Record<string, DocumentScannedState> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, DocumentScannedState> = {};
  for (const [docId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const statusRaw = (raw as { status?: unknown }).status;
    const detailRaw = (raw as { detail?: unknown }).detail;
    if (statusRaw !== "ok" && statusRaw !== "invalid" && statusRaw !== "unreadable") continue;
    const extractedRaw = (raw as { extractedData?: unknown }).extractedData;
    const extractedData =
      extractedRaw && typeof extractedRaw === "object"
        ? Object.fromEntries(
            Object.entries(extractedRaw as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v ?? ""),
            ])
          )
        : undefined;
    out[docId] = {
      status: statusRaw,
      detail: typeof detailRaw === "string" ? detailRaw : "",
      extractedData,
    };
  }
  return out;
}

function readKv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = String(v ?? "");
  }
  return out;
}

function rowToDraft(row: BrouillonRow): BonDraftData {
  const kv = readKv(row.vehicle_field_values);
  const mode = row.mode_paiement === "financement" ? "financement" : "comptant";
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientNom: row.client_nom ?? "",
    clientPrenom: row.client_prenom ?? "",
    clientDateNaissance: row.client_date_naissance ?? "",
    clientNumeroCni: row.client_numero_cni ?? "",
    clientAdresse: row.client_adresse ?? "",
    vehiculeModele: row.vehicule_modele ?? "",
    vehiculeVin: row.vehicule_vin ?? "",
    vehiculePremiereCirculation: row.vehicule_premiere_circulation ?? "",
    vehiculeKilometrage: row.vehicule_kilometrage ?? "",
    vehiculeCo2: row.vehicule_co2 ?? "",
    vehiculeChevaux: row.vehicule_chevaux ?? "",
    vehiculeCouleur: row.vehicule_couleur ?? "",
    vehiculePrix: row.vehicule_prix ?? "",
    repriseActive: kv.reprise_active === "true",
    reprisePlaque: kv.reprise_plaque ?? "",
    repriseMarque: kv.reprise_marque ?? "",
    repriseModele: kv.reprise_modele ?? "",
    repriseVin: kv.reprise_vin ?? "",
    reprisePremiereCirculation: kv.reprise_premiere_circulation ?? "",
    repriseValeur: kv.reprise_valeur ?? "",
    modePaiement: mode,
    acompte: row.acompte ?? "",
    vehiculeRemise: row.vehicule_remise ?? "",
    vehiculeDateLivraison: row.vehicule_date_livraison ?? "",
    documentsScanned: sanitizeScannedDocuments(row.documents_scanned),
  };
}

function draftToPayload(d: BonDraftData) {
  const kv: Record<string, string> = {
    reprise_active: d.repriseActive ? "true" : "false",
    reprise_plaque: d.reprisePlaque,
    reprise_marque: d.repriseMarque,
    reprise_modele: d.repriseModele,
    reprise_vin: d.repriseVin,
    reprise_premiere_circulation: d.reprisePremiereCirculation,
    reprise_valeur: d.repriseValeur,
  };
  return {
    client_nom: d.clientNom,
    client_prenom: d.clientPrenom,
    client_date_naissance: d.clientDateNaissance,
    client_numero_cni: d.clientNumeroCni,
    client_adresse: d.clientAdresse,
    vehicule_modele: d.vehiculeModele,
    vehicule_vin: d.vehiculeVin,
    vehicule_premiere_circulation: d.vehiculePremiereCirculation,
    vehicule_kilometrage: d.vehiculeKilometrage,
    vehicule_co2: d.vehiculeCo2,
    vehicule_chevaux: d.vehiculeChevaux,
    vehicule_couleur: d.vehiculeCouleur,
    vehicule_prix: d.vehiculePrix,
    vehicule_remise: d.vehiculeRemise,
    vehicule_date_livraison: d.vehiculeDateLivraison,
    acompte: d.acompte,
    mode_paiement: d.modePaiement,
    documents_scanned: d.documentsScanned ?? {},
    vehicle_field_values: kv,
  };
}

export async function loadDrafts(): Promise<BonDraftData[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("brouillons")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("loadDrafts:", error);
    return [];
  }
  return (data ?? []).map((row) => rowToDraft(row as BrouillonRow));
}

export async function getDraft(id: string): Promise<BonDraftData | undefined> {
  const userId = await getCurrentUserId();
  if (!userId) return undefined;
  const { data, error } = await supabase
    .from("brouillons")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("getDraft:", error);
    return undefined;
  }
  if (!data) return undefined;
  return rowToDraft(data as BrouillonRow);
}

export async function deleteDraft(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await supabase.from("brouillons").delete().eq("id", id).eq("user_id", userId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
}

export async function upsertDraft(
  partial: Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string }
): Promise<BonDraftData> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Session expirée. Reconnectez-vous pour sauvegarder le brouillon.");
  }
  const now = new Date().toISOString();

  if (partial.id) {
    const { data: existing } = await supabase
      .from("brouillons")
      .select("*")
      .eq("id", partial.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) {
      const merged: BonDraftData = {
        ...rowToDraft(existing as BrouillonRow),
        ...partial,
        id: partial.id,
        updatedAt: now,
      };
      const { error } = await supabase
        .from("brouillons")
        .update({ updated_at: now, ...draftToPayload(merged) })
        .eq("id", partial.id)
        .eq("user_id", userId);
      if (error) {
        console.error("upsertDraft update:", error);
        throw new Error(error.message || "Erreur lors de la mise à jour du brouillon.");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
      }
      return merged;
    }
  }

  const id = crypto.randomUUID?.() ?? String(Date.now());
  const { id: _omit, ...rest } = partial;
  const created: BonDraftData = {
    ...rest,
    id,
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await supabase.from("brouillons").insert({
    user_id: userId,
    id,
    created_at: now,
    updated_at: now,
    ...draftToPayload(created),
  });
  if (error) {
    console.error("upsertDraft insert:", error);
    throw new Error(error.message || "Erreur lors de la création du brouillon.");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
  return created;
}

import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

export type DocumentScannedState = {
  status: "ok" | "invalid" | "unreadable";
  detail: string;
  extractedData?: Record<string, string>;
};

/**
 * V2 — schéma libre côté véhicule.
 *
 * Sections du formulaire :
 *   - Client  : infos CNI
 *   - Véhicule : snapshot du véhicule sélectionné dans le stock (`stockDonnees`
 *                + `stockColonnes`). Le commercial peut éditer ces valeurs ;
 *                le PDF affichera un tableau clé/valeur pour chaque colonne
 *                dans `stockColonnes`.
 *   - Reprise  : saisie manuelle (non liée au stock).
 *   - Règlement : prix / remise / acompte / mode / date livraison.
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

  // Section 2 — Véhicule (depuis stock)
  /** UUID du véhicule dans `stock_vehicules` (vide si saisie manuelle libre). */
  vehiculeStockId: string;
  /** Paires clé/valeur = toutes les colonnes activées lors de la sélection. */
  stockDonnees: Record<string, string>;
  /** Ordre d'affichage des clés dans le form + PDF. */
  stockColonnes: string[];

  // Section 2b — Reprise
  repriseActive: boolean;
  reprisePlaque: string;
  repriseMarque: string;
  repriseModele: string;
  repriseVin: string;
  reprisePremiereCirculation: string;
  repriseValeur: string;
  /** Durée du crédit reprise en mois (saisie libre, vide si non applicable). */
  repriseDureeMois: string;

  // Section 3 — Règlement
  /** Saisi à la main (section Règlement). Pré-rempli depuis le stock si une
   *  colonne "Prix"/"Price"/"Tarif" y est détectée (cf. `guessPrixFromDonnees`). */
  vehiculePrix: string;
  modePaiement: "comptant" | "financement";
  acompte: string;
  vehiculeRemise: string;
  vehiculeDateLivraison: string;

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
  // Colonnes véhicule legacy : on les laisse en base, on ne les écrit plus.
  vehicule_prix: string;
  vehicule_remise: string;
  vehicule_date_livraison: string;
  acompte: string;
  mode_paiement: string;
  documents_scanned: unknown;
  /**
   * JSONB libre. En V2 on y met :
   *   - reprise_active / reprise_plaque / reprise_marque / reprise_modele /
   *     reprise_vin / reprise_premiere_circulation / reprise_valeur
   *   - vehicule_stock_id (string)
   *   - stock_donnees (object)
   *   - stock_colonnes (array of strings)
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
            ]),
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

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  }
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      if (Array.isArray(p)) return parseStringArray(p);
    } catch {
      /* ignore */
    }
  }
  return [];
}

function parseStringDict(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      try {
        return parseStringDict(JSON.parse(value));
      } catch {
        return {};
      }
    }
    return {};
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof k !== "string" || !k) continue;
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  return out;
}

function rowToDraft(row: BrouillonRow): BonDraftData {
  const rawKv =
    row.vehicle_field_values && typeof row.vehicle_field_values === "object"
      ? (row.vehicle_field_values as Record<string, unknown>)
      : {};
  const kvStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawKv)) kvStr[k] = String(v ?? "");
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

    vehiculeStockId: kvStr.vehicule_stock_id ?? "",
    stockDonnees: parseStringDict(rawKv.stock_donnees),
    stockColonnes: parseStringArray(rawKv.stock_colonnes),

    repriseActive: kvStr.reprise_active === "true",
    reprisePlaque: kvStr.reprise_plaque ?? "",
    repriseMarque: kvStr.reprise_marque ?? "",
    repriseModele: kvStr.reprise_modele ?? "",
    repriseVin: kvStr.reprise_vin ?? "",
    reprisePremiereCirculation: kvStr.reprise_premiere_circulation ?? "",
    repriseValeur: kvStr.reprise_valeur ?? "",
    repriseDureeMois: kvStr.reprise_duree_mois ?? "",

    vehiculePrix: row.vehicule_prix ?? "",
    modePaiement: mode,
    acompte: row.acompte ?? "",
    vehiculeRemise: row.vehicule_remise ?? "",
    vehiculeDateLivraison: row.vehicule_date_livraison ?? "",
    documentsScanned: sanitizeScannedDocuments(row.documents_scanned),
  };
}

function draftToPayload(d: BonDraftData) {
  const kv: Record<string, unknown> = {
    reprise_active: d.repriseActive ? "true" : "false",
    reprise_plaque: d.reprisePlaque,
    reprise_marque: d.repriseMarque,
    reprise_modele: d.repriseModele,
    reprise_vin: d.repriseVin,
    reprise_premiere_circulation: d.reprisePremiereCirculation,
    reprise_valeur: d.repriseValeur,
    reprise_duree_mois: d.repriseDureeMois ?? "",
    vehicule_stock_id: d.vehiculeStockId ?? "",
    stock_donnees: d.stockDonnees ?? {},
    stock_colonnes: Array.isArray(d.stockColonnes) ? d.stockColonnes : [],
  };
  return {
    client_nom: d.clientNom,
    client_prenom: d.clientPrenom,
    client_date_naissance: d.clientDateNaissance,
    client_numero_cni: d.clientNumeroCni,
    client_adresse: d.clientAdresse,
    // Les colonnes `vehicule_modele`, `vehicule_vin`, etc. ne sont plus
    // alimentées depuis la V2 (le véhicule vit dans `stock_donnees`). On les
    // laisse vides pour rester compatible avec la structure de table actuelle.
    vehicule_modele: "",
    vehicule_vin: "",
    vehicule_premiere_circulation: "",
    vehicule_kilometrage: "",
    vehicule_co2: "",
    vehicule_chevaux: "",
    vehicule_couleur: "",
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
  partial: Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string },
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
  void _omit;
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

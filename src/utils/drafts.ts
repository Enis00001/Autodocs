import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId, getCurrentUserId } from "@/lib/auth";

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
  clientEmail: string;
  /** Ligne directe (non affichée sur le bon PDF, facture / CRM). */
  clientTelephone: string;

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
  customFieldsValues: Record<string, string>;

  documentsScanned: Record<string, DocumentScannedState>;

  /**
   * Vrai dès qu'un PDF signé par le vendeur a été généré pour ce brouillon.
   * Persisté dans `vehicle_field_values.signed`.
   */
  signed?: boolean;
  /** Date ISO de la signature vendeur (si `signed === true`). */
  signedAt?: string;
  /**
   * Token de la dernière demande de signature client envoyée par email.
   * Permet d'afficher un statut « En attente de signature client » et
   * d'offrir un bouton « Renvoyer le lien ».
   */
  signatureRequestToken?: string;
  /** Date ISO d'envoi du dernier email de demande de signature. */
  signatureRequestSentAt?: string;
  /** Date ISO de signature côté client (signature via /signer/:token). */
  clientSignedAt?: string;
  /**
   * UUID de la fiche client (table `clients`) rattachée à ce brouillon.
   * Nullable : un bon peut être créé avant que sa fiche client n'existe.
   * La FK est `ON DELETE SET NULL` côté Postgres : supprimer un client
   * détache simplement les bons sans les détruire.
   */
  clientId?: string | null;
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
  /** FK optionnel vers `clients(id)` (CRM). */
  client_id: string | null;
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
    clientEmail: kvStr.client_email ?? "",
    clientTelephone: kvStr.client_telephone ?? "",

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
    customFieldsValues: parseStringDict(rawKv.custom_fields_values),
    documentsScanned: sanitizeScannedDocuments(row.documents_scanned),
    signed: kvStr.signed === "true",
    signedAt: kvStr.signed_at || undefined,
    signatureRequestToken: kvStr.signature_request_token || undefined,
    signatureRequestSentAt: kvStr.signature_request_sent_at || undefined,
    clientSignedAt: kvStr.client_signed_at || undefined,
    clientId: row.client_id ?? null,
  };
}

function draftToPayload(d: BonDraftData) {
  const kv: Record<string, unknown> = {
    client_email: d.clientEmail ?? "",
    client_telephone: d.clientTelephone ?? "",
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
    custom_fields_values: d.customFieldsValues ?? {},
    signed: d.signed ? "true" : "false",
    signed_at: d.signedAt ?? "",
    signature_request_token: d.signatureRequestToken ?? "",
    signature_request_sent_at: d.signatureRequestSentAt ?? "",
    client_signed_at: d.clientSignedAt ?? "",
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
    client_id: d.clientId ?? null,
  };
}

export async function loadDrafts(): Promise<BonDraftData[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("brouillons")
    .select("*")
    .eq("concession_id", concessionId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("loadDrafts:", error);
    return [];
  }
  return (data ?? []).map((row) => rowToDraft(row as BrouillonRow));
}

export async function getDraft(id: string): Promise<BonDraftData | undefined> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return undefined;
  const { data, error } = await supabase
    .from("brouillons")
    .select("*")
    .eq("id", id)
    .eq("concession_id", concessionId)
    .maybeSingle();
  if (error) {
    console.error("getDraft:", error);
    return undefined;
  }
  if (!data) return undefined;
  return rowToDraft(data as BrouillonRow);
}

/**
 * Marque un brouillon comme signé (le bon de commande a été signé par le
 * client). Utilisé après un upload réussi du PDF signé. La donnée est
 * persistée dans `vehicle_field_values` (clé `signed` + `signed_at`).
 */
export async function markDraftSigned(
  id: string,
  signedAt: string = new Date().toISOString(),
): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;

  const { data: existing, error: readError } = await supabase
    .from("brouillons")
    .select("vehicle_field_values")
    .eq("id", id)
    .eq("concession_id", concessionId)
    .maybeSingle();

  if (readError || !existing) {
    console.error("markDraftSigned read:", readError);
    return;
  }

  const currentKv =
    existing.vehicle_field_values && typeof existing.vehicle_field_values === "object"
      ? (existing.vehicle_field_values as Record<string, unknown>)
      : {};

  const nextKv = {
    ...currentKv,
    signed: "true",
    signed_at: signedAt,
  };

  const { error } = await supabase
    .from("brouillons")
    .update({
      vehicle_field_values: nextKv,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("concession_id", concessionId);

  if (error) {
    console.error("markDraftSigned update:", error);
    return;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
}

/**
 * Trace dans le brouillon qu'une demande de signature électronique a été
 * envoyée au client (token + date d'envoi). Utilisé pour afficher
 * « En attente de signature client » dans la liste des brouillons.
 */
export async function markDraftSignatureRequestSent(
  id: string,
  token: string,
  sentAt: string = new Date().toISOString(),
): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;

  const { data: existing, error: readError } = await supabase
    .from("brouillons")
    .select("vehicle_field_values")
    .eq("id", id)
    .eq("concession_id", concessionId)
    .maybeSingle();

  if (readError || !existing) {
    console.error("markDraftSignatureRequestSent read:", readError);
    return;
  }

  const currentKv =
    existing.vehicle_field_values && typeof existing.vehicle_field_values === "object"
      ? (existing.vehicle_field_values as Record<string, unknown>)
      : {};

  const nextKv = {
    ...currentKv,
    signature_request_token: token,
    signature_request_sent_at: sentAt,
  };

  const { error } = await supabase
    .from("brouillons")
    .update({
      vehicle_field_values: nextKv,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("concession_id", concessionId);

  if (error) {
    console.error("markDraftSignatureRequestSent update:", error);
    return;
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
}

export async function deleteDraft(id: string): Promise<boolean> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) {
    throw new Error("Non authentifié");
  }

  const { error } = await supabase
    .from("brouillons")
    .delete()
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("deleteDraft:", error);
    throw new Error(error.message || "Suppression impossible.");
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
  return true;
}

export async function upsertDraft(
  partial: Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<BonDraftData> {
  const [concessionId, userId] = await Promise.all([
    getCurrentConcessionId(),
    getCurrentUserId(),
  ]);
  if (!concessionId || !userId) {
    throw new Error("Session expirée. Reconnectez-vous pour sauvegarder le brouillon.");
  }
  const now = new Date().toISOString();

  const id = crypto.randomUUID?.() ?? String(Date.now());
  const targetId = partial.id ?? id;
  const created: BonDraftData = {
    ...partial,
    id: targetId,
    createdAt: now,
    updatedAt: now,
  };
  const payload = {
    // `user_id` reste écrit pour back-compat (colonne legacy NOT NULL dans
    // certaines bases). `concession_id` + `created_by` sont les colonnes
    // sources de vérité du modèle multi-utilisateurs.
    user_id: userId,
    concession_id: concessionId,
    created_by: userId,
    id: targetId,
    created_at: now,
    updated_at: now,
    ...draftToPayload(created),
  };
  const { data, error } = await supabase
    .from("brouillons")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();
  if (error) {
    console.error("upsertDraft upsert:", error);
    throw new Error(error.message || "Erreur lors de la sauvegarde du brouillon.");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
  return rowToDraft(data as BrouillonRow);
}

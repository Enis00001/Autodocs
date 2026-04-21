import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

/** Une option détaillée (nom + prix) pour la section Prix & coûts */
export type OptionDetail = { name: string; price: string };

export type DocumentScannedState = {
  status: "ok" | "invalid" | "unreadable";
  detail: string;
  extractedData?: Record<string, string>;
};

export type BonDraftData = {
  id: string;
  createdAt: string;
  updatedAt: string;
  clientNom: string;
  clientPrenom: string;
  clientDateNaissance: string;
  clientNumeroCni: string;
  clientAdresse: string;
  vehiculeModele: string;
  vehiculeVin: string;
  vehiculePremiereCirculation: string;
  vehiculeKilometrage: string;
  vehiculeCo2: string;
  vehiculeChevaux: string;
  vehiculePrix: string;
  optionsMode: "total" | "detail";
  optionsPrixTotal: string;
  optionsDetailJson: string;
  vehiculeCarteGrise: string;
  vehiculeFraisReprise: string;
  vehiculeRemise: string;
  vehiculeFinancement: string;
  vehiculeDateLivraison: string;
  vehiculeReprise: string;
  vehiculeCouleur: string;
  vehiculeOptions: string;
  acompte: string;
  modePaiement: "virement" | "cheque" | "cb";
  apport: string;
  organismePreteur: string;
  montantCredit: string;
  tauxCredit: string;
  dureeMois: string;
  clauseSuspensive: boolean;
  vendeurNom: string;
  vendeurNotes: string;
  templateId: string;
  documentsScanned: Record<string, DocumentScannedState>;
  /** Valeurs des champs véhicule configurés (clés = field_key). */
  vehicleFieldValues: Record<string, string>;
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
  vehicule_prix: string;
  options_mode: string;
  options_prix_total: string;
  options_detail_json: string;
  vehicule_carte_grise: string;
  vehicule_frais_reprise: string;
  vehicule_remise: string;
  vehicule_financement: string;
  vehicule_date_livraison: string;
  vehicule_reprise: string;
  vehicule_couleur: string;
  vehicule_options: string;
  acompte: string;
  mode_paiement: string;
  apport: string;
  organisme_preteur: string;
  montant_credit: string;
  taux_credit: string;
  duree_mois: string;
  clause_suspensive: boolean;
  vendeur_nom: string;
  vendeur_notes: string;
  template_id: string;
  documents_scanned: unknown;
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

function sanitizeVehicleFieldValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = String(v ?? "");
  }
  return out;
}

function rowToDraft(row: BrouillonRow): BonDraftData {
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
    vehiculePrix: row.vehicule_prix ?? "",
    optionsMode: (row.options_mode === "detail" ? "detail" : "total") as "total" | "detail",
    optionsPrixTotal: row.options_prix_total ?? "",
    optionsDetailJson: row.options_detail_json ?? "[]",
    vehiculeCarteGrise: row.vehicule_carte_grise ?? "",
    vehiculeFraisReprise: row.vehicule_frais_reprise ?? "",
    vehiculeRemise: row.vehicule_remise ?? "",
    vehiculeFinancement: row.vehicule_financement ?? "",
    vehiculeDateLivraison: row.vehicule_date_livraison ?? "",
    vehiculeReprise: row.vehicule_reprise ?? "",
    vehiculeCouleur: row.vehicule_couleur ?? "",
    vehiculeOptions: row.vehicule_options ?? "",
    acompte: row.acompte ?? "",
    modePaiement: (row.mode_paiement === "cheque" ? "cheque" : row.mode_paiement === "cb" ? "cb" : "virement") as "virement" | "cheque" | "cb",
    apport: row.apport ?? "",
    organismePreteur: row.organisme_preteur ?? "",
    montantCredit: row.montant_credit ?? "",
    tauxCredit: row.taux_credit ?? "",
    dureeMois: row.duree_mois ?? "",
    clauseSuspensive: Boolean(row.clause_suspensive),
    vendeurNom: row.vendeur_nom ?? "",
    vendeurNotes: row.vendeur_notes ?? "",
    templateId: row.template_id ?? "",
    documentsScanned: sanitizeScannedDocuments(row.documents_scanned),
    vehicleFieldValues: sanitizeVehicleFieldValues(row.vehicle_field_values),
  };
}

function draftToRow(d: BonDraftData): Omit<BrouillonRow, "created_at" | "updated_at"> & { created_at?: string; updated_at?: string } {
  return {
    id: d.id,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
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
    vehicule_prix: d.vehiculePrix,
    options_mode: d.optionsMode,
    options_prix_total: d.optionsPrixTotal,
    options_detail_json: d.optionsDetailJson,
    vehicule_carte_grise: d.vehiculeCarteGrise,
    vehicule_frais_reprise: d.vehiculeFraisReprise,
    vehicule_remise: d.vehiculeRemise,
    vehicule_financement: d.vehiculeFinancement,
    vehicule_date_livraison: d.vehiculeDateLivraison,
    vehicule_reprise: d.vehiculeReprise,
    vehicule_couleur: d.vehiculeCouleur,
    vehicule_options: d.vehiculeOptions,
    acompte: d.acompte,
    mode_paiement: d.modePaiement,
    apport: d.apport,
    organisme_preteur: d.organismePreteur,
    montant_credit: d.montantCredit,
    taux_credit: d.tauxCredit,
    duree_mois: d.dureeMois,
    clause_suspensive: d.clauseSuspensive,
    vendeur_nom: d.vendeurNom,
    vendeur_notes: d.vendeurNotes,
    template_id: d.templateId,
    documents_scanned: d.documentsScanned ?? {},
    vehicle_field_values: d.vehicleFieldValues ?? {},
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
  const { data, error } = await supabase.from("brouillons").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
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
      const updated: BonDraftData = {
        ...rowToDraft(existing as BrouillonRow),
        ...partial,
        id: partial.id,
        updatedAt: now,
      };
      const row = draftToRow(updated);
      const { error } = await supabase
        .from("brouillons")
        .update({
          updated_at: now,
          client_nom: row.client_nom,
          client_prenom: row.client_prenom,
          client_date_naissance: row.client_date_naissance,
          client_numero_cni: row.client_numero_cni,
          client_adresse: row.client_adresse,
          vehicule_modele: row.vehicule_modele,
          vehicule_vin: row.vehicule_vin,
          vehicule_premiere_circulation: row.vehicule_premiere_circulation,
          vehicule_kilometrage: row.vehicule_kilometrage,
          vehicule_co2: row.vehicule_co2,
          vehicule_chevaux: row.vehicule_chevaux,
          vehicule_prix: row.vehicule_prix,
          options_mode: row.options_mode,
          options_prix_total: row.options_prix_total,
          options_detail_json: row.options_detail_json,
          vehicule_carte_grise: row.vehicule_carte_grise,
          vehicule_frais_reprise: row.vehicule_frais_reprise,
          vehicule_remise: row.vehicule_remise,
          vehicule_financement: row.vehicule_financement,
          vehicule_date_livraison: row.vehicule_date_livraison,
          vehicule_reprise: row.vehicule_reprise,
          vehicule_couleur: row.vehicule_couleur,
          vehicule_options: row.vehicule_options,
          acompte: row.acompte,
          mode_paiement: row.mode_paiement,
          apport: row.apport,
          organisme_preteur: row.organisme_preteur,
          montant_credit: row.montant_credit,
          taux_credit: row.taux_credit,
          duree_mois: row.duree_mois,
          clause_suspensive: row.clause_suspensive,
          vendeur_nom: row.vendeur_nom,
          vendeur_notes: row.vendeur_notes,
          template_id: row.template_id,
          documents_scanned: row.documents_scanned,
          vehicle_field_values: row.vehicle_field_values,
        })
        .eq("id", partial.id)
        .eq("user_id", userId);
      if (error) {
        console.error("upsertDraft update:", error);
        throw new Error(error.message || "Erreur lors de la mise à jour du brouillon.");
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
      }
      return updated;
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
  const row = draftToRow(created);
  const { error } = await supabase.from("brouillons").insert({
    user_id: userId,
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_nom: row.client_nom,
    client_prenom: row.client_prenom,
    client_date_naissance: row.client_date_naissance,
    client_numero_cni: row.client_numero_cni,
    client_adresse: row.client_adresse,
    vehicule_modele: row.vehicule_modele,
    vehicule_vin: row.vehicule_vin,
    vehicule_premiere_circulation: row.vehicule_premiere_circulation,
    vehicule_kilometrage: row.vehicule_kilometrage,
    vehicule_co2: row.vehicule_co2,
    vehicule_chevaux: row.vehicule_chevaux,
    vehicule_prix: row.vehicule_prix,
    options_mode: row.options_mode,
    options_prix_total: row.options_prix_total,
    options_detail_json: row.options_detail_json,
    vehicule_carte_grise: row.vehicule_carte_grise,
    vehicule_frais_reprise: row.vehicule_frais_reprise,
    vehicule_remise: row.vehicule_remise,
    vehicule_financement: row.vehicule_financement,
    vehicule_date_livraison: row.vehicule_date_livraison,
    vehicule_reprise: row.vehicule_reprise,
    vehicule_couleur: row.vehicule_couleur,
    vehicule_options: row.vehicule_options,
    acompte: row.acompte,
    mode_paiement: row.mode_paiement,
    apport: row.apport,
    organisme_preteur: row.organisme_preteur,
    montant_credit: row.montant_credit,
    taux_credit: row.taux_credit,
    duree_mois: row.duree_mois,
    clause_suspensive: row.clause_suspensive,
    vendeur_nom: row.vendeur_nom,
    vendeur_notes: row.vendeur_notes,
    template_id: row.template_id,
    documents_scanned: row.documents_scanned,
    vehicle_field_values: row.vehicle_field_values,
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

import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";
import { apiFetch } from "@/lib/apiClient";

export type FactureStatut = "emise" | "payee" | "annulee";

export type FactureRecord = {
  id: string;
  concession_id: string;
  brouillon_id: string | null;
  client_id: string | null;
  numero_facture: string;
  date_facture: string;
  date_livraison: string | null;
  concession_nom: string | null;
  concession_siret: string | null;
  concession_adresse: string | null;
  concession_telephone: string | null;
  concession_email: string | null;
  concession_tva_intracommunautaire: string | null;
  client_nom: string | null;
  client_prenom: string | null;
  client_adresse: string | null;
  client_email: string | null;
  client_telephone: string | null;
  vehicule_marque: string | null;
  vehicule_modele: string | null;
  vehicule_version: string | null;
  vehicule_annee: string | null;
  vehicule_kilometrage: string | null;
  vehicule_vin: string | null;
  vehicule_immatriculation: string | null;
  vehicule_couleur: string | null;
  vehicule_energie: string | null;
  prix_ht: number | null;
  tva_taux: number | null;
  tva_montant: number | null;
  prix_ttc: number | null;
  acompte: number | null;
  reste_a_payer: number | null;
  reprise_vehicule_description: string | null;
  reprise_montant: number | null;
  prestations_supplementaires: unknown;
  statut: FactureStatut;
  notes: string | null;
  pdf_base64: string | null;
  created_at: string;
};

export type GenerateFacturePayload = {
  brouillon_id: string;
  client_adresse?: string;
  client_email?: string;
  client_telephone?: string;
  date_livraison?: string;
  acompte?: number;
  reprise_montant?: number;
  reprise_vehicule_description?: string;
  garantie_commerciale_active?: boolean;
  garantie_commerciale_mois?: number;
  kilometrage_non_garanti?: boolean;
  prestations_supplementaires?: { libelle: string; prix_ht: number }[];
  notes?: string;
  tva_taux?: number;
};

export type GenerateFactureResult = {
  ok: boolean;
  duplicate?: boolean;
  factureId?: string;
  numero_facture?: string;
  pdfBase64?: string;
  error?: string;
};

function notifyFacturesUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_factures_updated"));
  }
}

export async function generateFacture(
  payload: GenerateFacturePayload,
): Promise<GenerateFactureResult> {
  const res = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({ action: "generate-facture", ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Génération impossible",
    };
  }
  notifyFacturesUpdated();
  return {
    ok: true,
    duplicate: body.duplicate === true,
    factureId: typeof body.factureId === "string" ? body.factureId : undefined,
    numero_facture:
      typeof body.numero_facture === "string" ? body.numero_facture : undefined,
    pdfBase64: typeof body.pdfBase64 === "string" ? body.pdfBase64 : undefined,
  };
}

export async function getFactures(): Promise<FactureRecord[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("factures")
    .select(
      "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, created_at",
    )
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getFactures:", error);
    return [];
  }
  return (data ?? []) as FactureRecord[];
}

export async function getFactureById(id: string): Promise<FactureRecord | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(
      "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getFactureById:", error);
    return null;
  }
  return data ? (data as FactureRecord) : null;
}

export async function getFactureByBrouillonId(
  brouillonId: string,
): Promise<FactureRecord | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(
      "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, created_at",
    )
    .eq("brouillon_id", brouillonId)
    .maybeSingle();
  if (error) {
    console.error("getFactureByBrouillonId:", error);
    return null;
  }
  return data ? (data as FactureRecord) : null;
}

export async function getFacturesByClient(clientId: string): Promise<FactureRecord[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("factures")
    .select(
      "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, created_at",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getFacturesByClient:", error);
    return [];
  }
  return (data ?? []) as FactureRecord[];
}

export async function updateFactureStatut(
  id: string,
  statut: FactureStatut,
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Session expirée.");
  const { error } = await supabase.from("factures").update({ statut }).eq("id", id);
  if (error) {
    console.error("updateFactureStatut:", error);
    throw new Error(error.message || "Mise à jour impossible.");
  }
  notifyFacturesUpdated();
}

import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId } from "@/lib/auth";
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
  /**
   * Date/heure du dernier envoi par email de la facture au client
   * (NULL si jamais envoyée). Renseignée par l'action serveur
   * `send-facture-email` (cf. api/actions.ts).
   */
  email_envoye_at: string | null;
  created_at: string;
};

export type GenerateFacturePayload = {
  brouillon_id: string;
  client_adresse?: string;
  client_email?: string;
  client_telephone?: string;
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

const FACTURE_SELECT_COLS =
  "id, concession_id, brouillon_id, client_id, numero_facture, date_facture, date_livraison, concession_nom, concession_siret, concession_adresse, concession_telephone, concession_email, concession_tva_intracommunautaire, client_nom, client_prenom, client_adresse, client_email, client_telephone, vehicule_marque, vehicule_modele, vehicule_version, vehicule_annee, vehicule_kilometrage, vehicule_vin, vehicule_immatriculation, vehicule_couleur, vehicule_energie, prix_ht, tva_taux, tva_montant, prix_ttc, acompte, reste_a_payer, reprise_vehicule_description, reprise_montant, prestations_supplementaires, statut, notes, pdf_base64, email_envoye_at, created_at";

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
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("concession_id", concessionId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getFactures:", error);
    return [];
  }
  return (data ?? []) as FactureRecord[];
}

export async function getFactureById(id: string): Promise<FactureRecord | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("id", id)
    .eq("concession_id", concessionId)
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
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("brouillon_id", brouillonId)
    .eq("concession_id", concessionId)
    .maybeSingle();
  if (error) {
    console.error("getFactureByBrouillonId:", error);
    return null;
  }
  return data ? (data as FactureRecord) : null;
}

export async function getFacturesByClient(clientId: string): Promise<FactureRecord[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("factures")
    .select(FACTURE_SELECT_COLS)
    .eq("client_id", clientId)
    .eq("concession_id", concessionId)
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
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) throw new Error("Session expirée.");
  const { error } = await supabase
    .from("factures")
    .update({ statut })
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("updateFactureStatut:", error);
    throw new Error(error.message || "Mise à jour impossible.");
  }
  notifyFacturesUpdated();
}

export type SendFactureEmailPayload = {
  facture_id: string;
  client_email: string;
  client_nom?: string;
  client_prenom?: string;
  numero_facture?: string;
  /** Si fourni, évite une lecture supabase côté serveur. */
  pdf_base64?: string;
};

export type SendFactureEmailResult = {
  ok: boolean;
  email_envoye_at?: string;
  error?: string;
};

/**
 * Envoie la facture PDF par email au client.
 *
 * Le serveur (cf. api/actions.ts → handleSendFactureEmail) :
 *   1. Vérifie l'appartenance de la facture à la concession active.
 *   2. Envoie l'email via Resend avec le PDF en pièce jointe.
 *   3. Persiste `email_envoye_at = now()` sur la ligne `factures`.
 *
 * Notifie ensuite l'app via `autodocs_factures_updated` pour rafraîchir
 * la liste (badge « ✓ Envoyé »).
 */
export async function sendFactureEmail(
  payload: SendFactureEmailPayload,
): Promise<SendFactureEmailResult> {
  const res = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({ action: "send-facture-email", ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: typeof body.error === "string" ? body.error : "Envoi impossible",
    };
  }
  notifyFacturesUpdated();
  return {
    ok: true,
    email_envoye_at:
      typeof body.email_envoye_at === "string" ? body.email_envoye_at : undefined,
  };
}

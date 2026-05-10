import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId } from "@/lib/auth";
import type { BonDraftData } from "@/utils/drafts";

/**
 * CRM AutoDocs — fiches clients de la concession.
 *
 * RLS Supabase : la table `clients` est filtrée par `concession_id = auth.uid()`,
 * donc on ne peut techniquement pas lire/écrire la fiche d'une autre concession
 * même en cas d'oubli côté client. On ajoute néanmoins systématiquement
 * `concession_id = userId` dans les filtres pour sécurité défense en profondeur.
 */
export type ClientData = {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  telephone: string;
  adresse: string;
  dateNaissance: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientUpsertData = {
  nom: string;
  prenom: string;
  email?: string;
  telephone?: string;
  adresse?: string;
  dateNaissance?: string;
};

type ClientRow = {
  id: string;
  concession_id: string;
  nom: string;
  prenom: string;
  email: string | null;
  telephone: string | null;
  adresse?: string | null;
  date_naissance: string | null;
  created_at: string;
  updated_at: string;
};

function rowToClient(row: ClientRow): ClientData {
  return {
    id: row.id,
    nom: row.nom ?? "",
    prenom: row.prenom ?? "",
    email: row.email ?? "",
    telephone: row.telephone ?? "",
    adresse: row.adresse ?? "",
    dateNaissance: row.date_naissance ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lance un événement global pour rafraîchir les listes ouvertes. */
function notifyClientsUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_clients_updated"));
  }
}

/**
 * Liste tous les clients de la concession courante, triés par nom.
 * Renvoie un tableau vide si l'utilisateur n'est pas connecté.
 */
export async function getClients(): Promise<ClientData[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("concession_id", concessionId)
    .order("nom", { ascending: true })
    .order("prenom", { ascending: true });
  if (error) {
    console.error("getClients:", error);
    return [];
  }
  return (data ?? []).map((row) => rowToClient(row as ClientRow));
}

/**
 * Recherche par nom ou prénom (case-insensitive).
 * Si la query est vide, comportement identique à `getClients()`.
 */
export async function searchClients(query: string): Promise<ClientData[]> {
  const trimmed = query.trim();
  if (!trimmed) return getClients();

  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];

  // PostgREST `or` accepte une liste de filtres séparés par virgules. On
  // échappe la virgule et le pourcent pour éviter les injections de filtre.
  const escaped = trimmed.replace(/[,%]/g, " ").trim();
  const pattern = `%${escaped}%`;

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("concession_id", concessionId)
    .or(`nom.ilike.${pattern},prenom.ilike.${pattern},email.ilike.${pattern}`)
    .order("nom", { ascending: true })
    .order("prenom", { ascending: true });
  if (error) {
    console.error("searchClients:", error);
    return [];
  }
  return (data ?? []).map((row) => rowToClient(row as ClientRow));
}

/**
 * Autocomplétion CRM (nom / prénom uniquement), max 10 résultats.
 * Query vide → aucun appel réseau (tableau vide).
 * Équivalent SQL : … WHERE concession_id = … AND (nom ILIKE … OR prenom ILIKE …) LIMIT 10
 */
export async function searchClientsAutocomplete(query: string): Promise<ClientData[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];

  const escaped = trimmed.replace(/[,%]/g, " ").trim();
  if (!escaped) return [];
  const pattern = `%${escaped}%`;

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("concession_id", concessionId)
    .or(`nom.ilike.${pattern},prenom.ilike.${pattern}`)
    .order("nom", { ascending: true })
    .order("prenom", { ascending: true })
    .limit(10);
  if (error) {
    console.error("searchClientsAutocomplete:", error);
    return [];
  }
  return (data ?? []).map((row) => rowToClient(row as ClientRow));
}

/** Récupère un client par son id. */
export async function getClientById(id: string): Promise<ClientData | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .eq("concession_id", concessionId)
    .maybeSingle();
  if (error) {
    console.error("getClientById:", error);
    return null;
  }
  return data ? rowToClient(data as ClientRow) : null;
}

/**
 * Récupère les brouillons (= bons de commande) liés à un client donné.
 * On ne renvoie pas le format complet `BonDraftData` — pour la fiche client on
 * a juste besoin d'un résumé : id, date, libellé véhicule, statut.
 */
export type ClientBonResume = {
  id: string;
  createdAt: string;
  updatedAt: string;
  vehiculeLabel: string;
  signed: boolean;
  signatureSent: boolean;
  clientSigned: boolean;
};

type BrouillonResumeRow = {
  id: string;
  created_at: string;
  updated_at: string;
  vehicle_field_values: unknown;
};

function resumeFromRow(row: BrouillonResumeRow): ClientBonResume {
  const kv =
    row.vehicle_field_values && typeof row.vehicle_field_values === "object"
      ? (row.vehicle_field_values as Record<string, unknown>)
      : {};

  // Reconstitution du libellé véhicule à partir de stock_donnees + stock_colonnes
  const stockDonneesRaw = kv.stock_donnees;
  const stockDonnees: Record<string, string> =
    stockDonneesRaw && typeof stockDonneesRaw === "object"
      ? Object.fromEntries(
          Object.entries(stockDonneesRaw as Record<string, unknown>).map(
            ([k, v]) => [k, String(v ?? "")],
          ),
        )
      : {};
  const stockColonnesRaw = kv.stock_colonnes;
  const stockColonnes: string[] = Array.isArray(stockColonnesRaw)
    ? (stockColonnesRaw as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim() !== "",
      )
    : [];
  const order =
    stockColonnes.length > 0 ? stockColonnes : Object.keys(stockDonnees);
  const vehiculeLabel =
    order
      .map((k) => (stockDonnees[k] ?? "").trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ") || "—";

  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    vehiculeLabel,
    signed: kv.signed === "true",
    signatureSent: typeof kv.signature_request_token === "string" && !!kv.signature_request_token,
    clientSigned: typeof kv.client_signed_at === "string" && !!kv.client_signed_at,
  };
}

/** Liste les brouillons rattachés à un client (via FK `client_id`). */
export async function getBonsForClient(clientId: string): Promise<ClientBonResume[]> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return [];
  const { data, error } = await supabase
    .from("brouillons")
    .select("id, created_at, updated_at, vehicle_field_values")
    .eq("concession_id", concessionId)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getBonsForClient:", error);
    return [];
  }
  return (data ?? []).map((row) => resumeFromRow(row as BrouillonResumeRow));
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Cherche un client existant correspondant aux nom + prénom donnés (recherche
 * insensible à la casse / aux espaces). Utilisé depuis l'écran "Brouillons"
 * pour proposer un lien automatique vers la fiche client.
 */
export async function findClientByNomPrenom(
  nom: string,
  prenom: string,
): Promise<ClientData | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const nomTrim = nom.trim();
  const prenomTrim = prenom.trim();
  if (!nomTrim || !prenomTrim) return null;

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("concession_id", concessionId)
    .ilike("nom", nomTrim)
    .ilike("prenom", prenomTrim)
    .limit(1);
  if (error) {
    console.error("findClientByNomPrenom:", error);
    return null;
  }
  const list = (data ?? []) as ClientRow[];
  // Belt and suspenders : on revérifie l'égalité après normalize côté client.
  const match = list.find(
    (row) =>
      normalizeName(row.nom ?? "") === normalizeName(nomTrim) &&
      normalizeName(row.prenom ?? "") === normalizeName(prenomTrim),
  );
  return match ? rowToClient(match) : null;
}

/**
 * Équivalent à `findClientByNomPrenom` : une ligne `clients` pour la concession
 * courante avec le même nom et prénom (normalisation insensible à la casse).
 * Utilisé par le flux « Clôturer la vente ».
 */
export const findClientExactNomPrenom = findClientByNomPrenom;

/** Crée une nouvelle fiche client. Renvoie la fiche créée. */
export async function createClient(input: ClientUpsertData): Promise<ClientData> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) {
    throw new Error("Session expirée. Reconnectez-vous pour créer un client.");
  }
  const nom = input.nom.trim();
  const prenom = input.prenom.trim();
  if (!nom || !prenom) {
    throw new Error("Le nom et le prénom sont obligatoires.");
  }

  const payload = {
    concession_id: concessionId,
    nom,
    prenom,
    email: input.email?.trim() || null,
    telephone: input.telephone?.trim() || null,
    adresse: input.adresse?.trim() || null,
    date_naissance: input.dateNaissance?.trim() || null,
  };

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("*")
    .single();
  if (error || !data) {
    console.error("createClient:", error);
    throw new Error(error?.message || "Impossible de créer le client.");
  }
  notifyClientsUpdated();
  return rowToClient(data as ClientRow);
}

/** Met à jour une fiche client. Renvoie la fiche mise à jour. */
export async function updateClient(
  id: string,
  input: ClientUpsertData,
): Promise<ClientData> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) {
    throw new Error("Session expirée. Reconnectez-vous pour modifier le client.");
  }
  const nom = input.nom.trim();
  const prenom = input.prenom.trim();
  if (!nom || !prenom) {
    throw new Error("Le nom et le prénom sont obligatoires.");
  }

  const payload = {
    nom,
    prenom,
    email: input.email?.trim() || null,
    telephone: input.telephone?.trim() || null,
    adresse: input.adresse?.trim() || null,
    date_naissance: input.dateNaissance?.trim() || null,
  };

  const { data, error } = await supabase
    .from("clients")
    .update(payload)
    .eq("id", id)
    .eq("concession_id", concessionId)
    .select("*")
    .single();
  if (error || !data) {
    console.error("updateClient:", error);
    throw new Error(error?.message || "Impossible de mettre à jour le client.");
  }
  notifyClientsUpdated();
  return rowToClient(data as ClientRow);
}

/** Supprime une fiche client (les bons de commande liés perdent juste le lien). */
export async function deleteClient(id: string): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("deleteClient:", error);
    throw new Error(error.message || "Impossible de supprimer le client.");
  }
  notifyClientsUpdated();
}

/**
 * Statistiques agrégées (par client) : nombre de bons + date du dernier bon.
 * Pas d'agrégat SQL côté Supabase ici (la lib préfère du REST simple) — on
 * récupère tous les brouillons du user et on agrège côté client. C'est OK
 * tant que la concession reste sous quelques milliers de bons.
 */
export type ClientStats = {
  clientId: string;
  bonsCount: number;
  lastBonAt: string | null;
};

export async function getClientStats(): Promise<Map<string, ClientStats>> {
  const concessionId = await getCurrentConcessionId();
  const map = new Map<string, ClientStats>();
  if (!concessionId) return map;

  const { data, error } = await supabase
    .from("brouillons")
    .select("client_id, created_at")
    .eq("concession_id", concessionId)
    .not("client_id", "is", null);
  if (error) {
    console.error("getClientStats:", error);
    return map;
  }

  for (const row of (data ?? []) as { client_id: string | null; created_at: string }[]) {
    if (!row.client_id) continue;
    const existing = map.get(row.client_id);
    if (!existing) {
      map.set(row.client_id, {
        clientId: row.client_id,
        bonsCount: 1,
        lastBonAt: row.created_at,
      });
    } else {
      existing.bonsCount += 1;
      if (!existing.lastBonAt || existing.lastBonAt < row.created_at) {
        existing.lastBonAt = row.created_at;
      }
    }
  }
  return map;
}

/**
 * Pré-remplit les champs d'une fiche client à partir d'un brouillon.
 * Utilisé depuis l'écran "Brouillons" → bouton "Créer la fiche client".
 */
export function clientUpsertFromDraft(draft: BonDraftData): ClientUpsertData {
  return {
    nom: draft.clientNom ?? "",
    prenom: draft.clientPrenom ?? "",
    email: draft.clientEmail ?? "",
    telephone: draft.clientTelephone ?? "",
    adresse: draft.clientAdresse ?? "",
    dateNaissance: draft.clientDateNaissance ?? "",
  };
}

/** Lie (ou délie en passant `null`) un brouillon à un client donné. */
export async function attachDraftToClient(
  draftId: string,
  clientId: string | null,
): Promise<void> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return;
  const { error } = await supabase
    .from("brouillons")
    .update({ client_id: clientId, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("concession_id", concessionId);
  if (error) {
    console.error("attachDraftToClient:", error);
    throw new Error(error.message || "Impossible de lier le brouillon au client.");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_drafts_updated"));
  }
}

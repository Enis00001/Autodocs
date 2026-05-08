import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";

/**
 * Profil détaillé de la concession (vendeur) utilisé pour pré-remplir
 * la section vendeur du CERFA 15776*01 (déclaration de cession).
 *
 * Stocké dans la table `profil_concession` (1 ligne / `user_id`).
 */
export type ProfilConcession = {
  nomConcession: string;
  adresse: string;
  codePostal: string;
  ville: string;
  siren: string;
  telephone: string;
};

export const emptyProfilConcession: ProfilConcession = {
  nomConcession: "",
  adresse: "",
  codePostal: "",
  ville: "",
  siren: "",
  telephone: "",
};

type ProfilConcessionRow = {
  id: string;
  user_id: string;
  nom_concession: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  siren: string | null;
  telephone: string | null;
  updated_at: string | null;
};

function rowToProfil(row: ProfilConcessionRow): ProfilConcession {
  return {
    nomConcession: row.nom_concession ?? "",
    adresse: row.adresse ?? "",
    codePostal: row.code_postal ?? "",
    ville: row.ville ?? "",
    siren: row.siren ?? "",
    telephone: row.telephone ?? "",
  };
}

/**
 * Charge le profil concession de l'utilisateur courant. Renvoie `null`
 * si aucune ligne n'existe encore (le commercial n'a jamais ouvert
 * /profil-concession) — l'appelant peut alors afficher un bandeau
 * d'invitation à compléter le profil.
 */
export async function loadProfilConcession(): Promise<ProfilConcession | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profil_concession")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("loadProfilConcession:", error);
    return null;
  }
  if (!data) return null;
  return rowToProfil(data as ProfilConcessionRow);
}

/**
 * Upsert du profil concession (1 ligne par utilisateur, garanti par
 * la contrainte UNIQUE sur user_id côté SQL).
 */
export async function saveProfilConcession(profil: ProfilConcession): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) {
    throw new Error("Session expirée. Reconnectez-vous pour sauvegarder le profil.");
  }
  const payload = {
    user_id: userId,
    nom_concession: profil.nomConcession.trim() || null,
    adresse: profil.adresse.trim() || null,
    code_postal: profil.codePostal.trim() || null,
    ville: profil.ville.trim() || null,
    siren: profil.siren.trim() || null,
    telephone: profil.telephone.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("profil_concession")
    .upsert(payload, { onConflict: "user_id" });
  if (error) {
    console.error("saveProfilConcession:", error);
    throw new Error(error.message || "Erreur lors de la sauvegarde du profil.");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("autodocs_profil_concession_updated"));
  }
}

/**
 * Vrai si le profil contient au minimum les champs requis pour pré-remplir
 * la section vendeur du CERFA (nom + adresse + CP + ville).
 */
export function isProfilCessionComplet(profil: ProfilConcession | null): boolean {
  if (!profil) return false;
  return (
    profil.nomConcession.trim() !== "" &&
    profil.adresse.trim() !== "" &&
    profil.codePostal.trim() !== "" &&
    profil.ville.trim() !== ""
  );
}

import { supabase } from "@/lib/supabase";
import { getCurrentConcessionId } from "@/lib/auth";

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
  siret: string;
  telephone: string;
  tvaIntracommunautaire: string;
  emailContact: string;
};

export const emptyProfilConcession: ProfilConcession = {
  nomConcession: "",
  adresse: "",
  codePostal: "",
  ville: "",
  siren: "",
  siret: "",
  telephone: "",
  tvaIntracommunautaire: "",
  emailContact: "",
};

type ProfilConcessionRow = {
  id: string;
  user_id: string;
  nom_concession: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  siren: string | null;
  siret?: string | null;
  telephone: string | null;
  tva_intracommunautaire?: string | null;
  email_contact?: string | null;
  updated_at: string | null;
};

function rowToProfil(row: ProfilConcessionRow): ProfilConcession {
  return {
    nomConcession: row.nom_concession ?? "",
    adresse: row.adresse ?? "",
    codePostal: row.code_postal ?? "",
    ville: row.ville ?? "",
    siren: row.siren ?? "",
    siret: row.siret ?? "",
    telephone: row.telephone ?? "",
    tvaIntracommunautaire: row.tva_intracommunautaire ?? "",
    emailContact: row.email_contact ?? "",
  };
}

/**
 * Charge le profil concession de l'utilisateur courant. Renvoie `null`
 * si aucune ligne n'existe encore (le commercial n'a jamais ouvert
 * /profil-concession) — l'appelant peut alors afficher un bandeau
 * d'invitation à compléter le profil.
 */
export async function loadProfilConcession(): Promise<ProfilConcession | null> {
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) return null;
  const { data, error } = await supabase
    .from("profil_concession")
    .select("*")
    .eq("concession_id", concessionId)
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
  const concessionId = await getCurrentConcessionId();
  if (!concessionId) {
    throw new Error("Session expirée. Reconnectez-vous pour sauvegarder le profil.");
  }
  const payload = {
    concession_id: concessionId,
    nom_concession: profil.nomConcession.trim() || null,
    adresse: profil.adresse.trim() || null,
    code_postal: profil.codePostal.trim() || null,
    ville: profil.ville.trim() || null,
    siren: profil.siren.trim() || null,
    siret: profil.siret.trim() || null,
    telephone: profil.telephone.trim() || null,
    tva_intracommunautaire: profil.tvaIntracommunautaire.trim() || null,
    email_contact: profil.emailContact.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("profil_concession")
    .upsert(payload, { onConflict: "concession_id" });
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

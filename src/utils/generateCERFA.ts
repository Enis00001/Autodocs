/**
 * Données envoyées au serveur pour remplir le PDF officiel
 * `public/templates/cerfa_15776-01.pdf` (CERFA 15776*01,
 * Déclaration de cession d'un véhicule d'occasion).
 *
 * Toutes les chaînes sont libres (le serveur tolère les valeurs
 * vides). Les booléens contrôlent les cases à cocher du PDF :
 * laisser `undefined` ou `false` pour ne pas cocher.
 */
export type CerfaData = {
  // ---- Véhicule ----
  immatriculation: string;
  vin?: string;
  /** "DD/MM/YYYY" ou "YYYY-MM-DD" — le serveur découpe en J/M/A. */
  date_mise_en_circulation?: string;
  marque: string;
  /** D.2 — type, variante, version (souvent vide). */
  type_variante?: string;
  /** J.1 — VP, CTTE, MOTO, CYCL, VASP, CAM, REM, SREM. */
  genre: string;
  /** D.3 — dénomination commerciale (modèle). */
  denomination: string;
  kilometrage: string;
  /** Si renseigné → la case « OUI » est cochée et le numéro est inscrit. */
  numero_formule?: string;
  /** Si ancien format d'immatriculation : date du certificat. */
  date_ci_ancien_format?: string;
  motif_absence_ci?: string;

  // ---- Vendeur (concession) ----
  vendeur_type: "morale" | "physique";
  /** Pertinent uniquement si `vendeur_type` = "physique". */
  vendeur_sexe?: "M" | "F";
  vendeur_nom: string;
  vendeur_siren?: string;
  vendeur_adresse: string;
  vendeur_code_postal: string;
  vendeur_ville: string;
  cession_date: string;
  /** "HH", "HH:MM" ou "HHhMM". */
  cession_heure: string;
  cession_lieu: string;
  /** "" (céder) ou "destruction" (céder pour destruction). */
  cession_motif?: "" | "destruction";
  certif_situation_admin?: boolean;
  certif_pas_transformation?: boolean;
  certif_vhu?: boolean;
  vendeur_agrement_vhu?: string;

  // ---- Acheteur ----
  acheteur_type: "physique" | "morale";
  acheteur_sexe?: "M" | "F";
  acheteur_nom: string;
  acheteur_prenom: string;
  acheteur_siret?: string;
  acheteur_date_naissance?: string;
  acheteur_lieu_naissance?: string;
  acheteur_adresse: string;
  acheteur_code_postal: string;
  acheteur_ville: string;
  /** Cochées par défaut (formulaire valide ⇒ acheteur acquiert et est informé). */
  acheteur_cert_acquerir?: boolean;
  acheteur_cert_informe?: boolean;

  /** Opposition à la prospection commerciale (mention bas de page). */
  opposition_prospection?: boolean;
};

/**
 * Appelle l'action `fill-cerfa` côté serveur et renvoie le PDF rempli
 * (2 exemplaires identiques, page 1 = ancien proprio, page 2 = nouveau)
 * encodé en base64.
 */
export async function generateCERFA(cerfa_data: CerfaData): Promise<string> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({ action: "fill-cerfa", cerfa_data }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      body.error || `Échec de la génération CERFA (${response.status})`,
    );
  }

  const json = (await response.json()) as { pdf_base64?: string };
  if (!json.pdf_base64) {
    throw new Error("Réponse serveur invalide (pdf_base64 manquant).");
  }
  return json.pdf_base64;
}

/**
 * Convertit un base64 PDF en téléchargement navigateur.
 * Réutilisable depuis l'historique CERFA.
 */
export function downloadCerfaPdf(pdfBase64: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = `data:application/pdf;base64,${pdfBase64}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

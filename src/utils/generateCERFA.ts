import type { BonDraftData } from "@/utils/drafts";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { loadConcession } from "@/utils/concession";
import { supabase } from "@/lib/supabase";

/* -------------------------------------------------------------------------- */
/*  Mapping heuristique des colonnes véhicule libres → champs CERFA           */
/* -------------------------------------------------------------------------- */

/**
 * Le stock véhicule a un schéma libre (cf. `src/utils/stockVehicules.ts`) :
 * les clés sont les noms de colonnes du fichier source du commercial. Pour
 * pré-remplir le CERFA on cherche, pour chaque champ requis, la première
 * colonne dont le nom matche un des patterns ci-dessous (case-insensitive,
 * accent-insensitive).
 */
const FIELD_PATTERNS: Record<string, RegExp[]> = {
  marque: [/^marque$/i, /\bmarque\b/i, /\bbrand\b/i, /\bmake\b/i],
  modele: [/^mod[eè]le$/i, /\bmod[eè]le\b/i, /\btype\b/i, /\bmodel\b/i],
  immatriculation: [
    /immatriculation/i,
    /\bplaque\b/i,
    /^plate$/i,
    /^plate\b/i,
    /\bplate\b/i,
  ],
  vin: [/\bvin\b/i, /ch[âa]ssis/i, /serial/i, /num[ée]ro de s[ée]rie/i],
  premiereCirculation: [
    /1[èe]?re? ?(?:mise )?(?:en )?circulation/i,
    /\bmec\b/i,
    /\bdate ?de ?mise ?en ?circulation\b/i,
    /\bfirst registration\b/i,
  ],
  kilometrage: [
    /kilom[ée]trage/i,
    /\bkilom[ée]tres?\b/i,
    /\bkm\b/i,
    /\bmileage\b/i,
    /odom/i,
  ],
};

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function findFieldValue(
  donnees: Record<string, string>,
  patterns: RegExp[],
): string {
  for (const [rawKey, value] of Object.entries(donnees)) {
    if (!value || !value.trim()) continue;
    const normalizedKey = normalizeKey(rawKey);
    if (patterns.some((re) => re.test(normalizedKey))) {
      return value.trim();
    }
  }
  return "";
}

/* -------------------------------------------------------------------------- */
/*  Construction du formData CERFA                                            */
/* -------------------------------------------------------------------------- */

export type CerfaCessionOverrides = {
  /** Date de cession au format JJ/MM/AAAA (par défaut : aujourd'hui). */
  dateCession?: string;
  /** Heure HH:MM (par défaut : heure courante). */
  heureCession?: string;
  /** Lieu de cession (par défaut : ville extraite de l'adresse concession). */
  lieuCession?: string;
  /** Cocher la case « Vendu en l'état ». */
  venduEnLetat?: boolean;
  /** Cocher la case « Avec contrôle technique ». */
  avecControleTechnique?: boolean;
  /** SIREN à afficher (sinon laissé vide). */
  sirenVendeur?: string;
};

function todayFr(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * Tente d'extraire la ville depuis l'adresse de la concession. Cherche le
 * 1er code postal (5 chiffres) et renvoie ce qui suit. Renvoie l'adresse
 * intégrale si rien ne matche — c'est mieux que rien.
 */
function guessLieuCession(adresse: string): string {
  if (!adresse) return "";
  const match = adresse.match(/\b\d{5}\b\s+([^\n,]+)/);
  if (match?.[1]) return match[1].trim();
  return adresse.trim();
}

/**
 * Construit le `formData` à envoyer à `/api/generate-pdf` (avec
 * `documentType: "cerfa"`) à partir d'un brouillon AutoDocs.
 *
 * - Vendeur : tiré de la table `concession` (ou des metadata Auth en
 *   fallback de bootstrap, déjà géré par `loadConcession`).
 * - Acheteur : champs `client*` du brouillon.
 * - Véhicule : extrait via `findFieldValue` sur `stockDonnees`, ou pré-rempli
 *   à vide si la colonne correspondante n'existe pas (le commercial pourra
 *   compléter à la main sur le PDF).
 */
export async function buildCerfaFormData(
  draft: BonDraftData,
  overrides: CerfaCessionOverrides = {},
): Promise<Record<string, string>> {
  const concession = await loadConcession();

  // SIREN : fourni par l'appelant en priorité, sinon depuis user_metadata
  // (champ libre `siren`), sinon vide.
  let sirenVendeur = overrides.sirenVendeur?.trim() ?? "";
  if (!sirenVendeur) {
    try {
      const { data } = await supabase.auth.getUser();
      const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
      const candidate =
        (meta?.siren as string | undefined) ??
        (meta?.SIREN as string | undefined) ??
        "";
      sirenVendeur = String(candidate ?? "").trim();
    } catch {
      sirenVendeur = "";
    }
  }

  const donnees = draft.stockDonnees ?? {};
  const marque = findFieldValue(donnees, FIELD_PATTERNS.marque);
  const modele = findFieldValue(donnees, FIELD_PATTERNS.modele);
  const immatriculation = findFieldValue(donnees, FIELD_PATTERNS.immatriculation);
  const vin = findFieldValue(donnees, FIELD_PATTERNS.vin);
  const premiereCirculation = findFieldValue(
    donnees,
    FIELD_PATTERNS.premiereCirculation,
  );
  const kilometrage = findFieldValue(donnees, FIELD_PATTERNS.kilometrage);

  const dateCession = overrides.dateCession?.trim() || todayFr();
  const heureCession = overrides.heureCession?.trim() || nowHHMM();
  const lieuCession =
    overrides.lieuCession?.trim() || guessLieuCession(concession.address);

  return {
    NOM_VENDEUR: concession.name ?? "",
    ADRESSE_VENDEUR: concession.address ?? "",
    SIREN_VENDEUR: sirenVendeur,

    NOM_ACHETEUR: draft.clientNom ?? "",
    PRENOM_ACHETEUR: draft.clientPrenom ?? "",
    ADRESSE_ACHETEUR: draft.clientAdresse ?? "",
    DATE_NAISSANCE_ACHETEUR: draft.clientDateNaissance ?? "",

    MARQUE_VEHICULE: marque,
    MODELE_VEHICULE: modele,
    IMMATRICULATION: immatriculation,
    VIN: vin,
    PREMIERE_CIRCULATION: premiereCirculation,
    KILOMETRAGE: kilometrage,

    DATE_CESSION: dateCession,
    HEURE_CESSION: heureCession,
    LIEU_CESSION: lieuCession,
    ETAT_VENDU_EN_LETAT: overrides.venduEnLetat ? "x" : "",
    ETAT_AVEC_CT: overrides.avecControleTechnique ? "x" : "",
  };
}

/* -------------------------------------------------------------------------- */
/*  Génération du PDF CERFA                                                   */
/* -------------------------------------------------------------------------- */

export type GenerateCerfaOptions = {
  /**
   * Si `true` (défaut), déclenche le téléchargement automatique dans le
   * navigateur. Mettre à `false` pour récupérer juste le base64 et
   * orchestrer un autre flow (ex. envoi par email).
   */
  download?: boolean;
  /** Surcharges des champs cession / SIREN avant rendu. */
  overrides?: CerfaCessionOverrides;
  /** Signature vendeur déjà capturée (data URL ou base64 PNG). Optionnelle. */
  signatureVendeurBase64?: string;
};

function sanitizeFileNameSegment(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Génère le PDF du CERFA 15776*01 (Déclaration de cession d'un véhicule)
 * à partir d'un brouillon AutoDocs et le télécharge dans le navigateur.
 *
 * Réutilise l'endpoint existant `/api/generate-pdf` en passant
 * `documentType: "cerfa"` (pas de nouvelle route serverless créée).
 */
export async function generateCERFA(
  draft: BonDraftData,
  options: GenerateCerfaOptions = {},
): Promise<{ pdfBase64: string; fileName: string }> {
  const { download = true, overrides, signatureVendeurBase64 } = options;

  const formData = await buildCerfaFormData(draft, overrides);

  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/generate-pdf", {
    method: "POST",
    body: JSON.stringify({
      formData,
      documentType: "cerfa",
      signatureVendeurBase64,
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    console.error("[generateCERFA] Erreur:", errBody);
    throw new Error(
      errBody?.error || `Erreur génération CERFA (${response.status})`,
    );
  }

  const json = (await response.json()) as { pdfBase64?: string };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur (CERFA).");
  }

  const clientSegment = sanitizeFileNameSegment(
    `${draft.clientPrenom ?? ""}-${draft.clientNom ?? ""}`.trim() || "client",
  );
  const fileName = `cerfa-15776-${clientSegment || "client"}-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;

  if (download) {
    downloadBase64Pdf(json.pdfBase64, fileName);
  }

  return { pdfBase64: json.pdfBase64, fileName };
}

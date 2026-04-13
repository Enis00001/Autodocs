/**
 * Mapping déterministe nom de champ AcroForm → clé formulaire (BonDraftData + clés dynamiques).
 * Aucune heuristique « aléatoire » : uniquement des motifs sur le libellé normalisé du champ PDF.
 */

export const BON_DRAFT_KEYS = [
  "clientNom",
  "clientPrenom",
  "clientDateNaissance",
  "clientNumeroCni",
  "clientAdresse",
  "ribTitulaire",
  "ribIban",
  "ribBic",
  "ribBanque",
  "clientEmail",
  "clientTelephone",
  "vehiculeModele",
  "vehiculeVin",
  "vehiculePremiereCirculation",
  "vehiculeKilometrage",
  "vehiculeCo2",
  "vehiculeChevaux",
  "vehiculePrix",
  "optionsMode",
  "optionsPrixTotal",
  "optionsDetailJson",
  "vehiculeCarteGrise",
  "vehiculeFraisReprise",
  "vehiculeRemise",
  "vehiculeFinancement",
  "vehiculeDateLivraison",
  "vehiculeReprise",
  "vehiculeCouleur",
  "vehiculeOptions",
  "acompte",
  "modePaiement",
  "apport",
  "organismePreteur",
  "montantCredit",
  "tauxCredit",
  "dureeMois",
  "clauseSuspensive",
  "vendeurNom",
  "vendeurNotes",
  "templateId",
] as const;

export function normalizePdfFieldLabel(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\[\].]/g, " ")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Rule = { key: string; match: (n: string) => boolean };

/**
 * Règles du plus spécifique au plus général. La première qui matche gagne pour ce champ PDF.
 * Les champs non reconnus ne sont pas ajoutés au mapping (case PDF laissée vide au remplissage).
 */
const RULES: Rule[] = [
  {
    key: "vehiculePremiereCirculation",
    match: (n) =>
      /(1ere|1ère|premiere|première)\s*(m\.?\s*e\.?\s*c\.?|mise\s*en\s*circulation)/.test(n) ||
      /\bm\.?\s*e\.?\s*c\.?\b/.test(n) ||
      /premiere\s*mise\s*en\s*circulation|première\s*mise\s*en\s*circulation/.test(n) ||
      /(date\s*)?(de\s*)?(1ere|1ère|premiere|première)\s*circulation/.test(n) ||
      /\bpec\b.*circulation|circulation.*\bpec\b/.test(n),
  },
  {
    key: "clientDateNaissance",
    match: (n) =>
      /naissance|date\s*de\s*naissance|ddn|date\s*naiss|nee\s*le|ne\(e\)\s*le|birth/.test(n) &&
      !/mise\s*en\s*circulation|circulation\s*vehicule/.test(n),
  },
  {
    key: "clientNumeroCni",
    match: (n) =>
      /\bcni\b|carte\s*d\s*identit|identit.*n|n\s*identit|numero\s*d?\s*identit|piece\s*d?\s*identit/.test(
        n
      ),
  },
  {
    key: "clientPrenom",
    match: (n) =>
      /pr[eé]nom|prenom|first\s*name|given\s*name/.test(n) &&
      !/nom\s*(et|&|\/)\s*pr[eé]nom|nom\s*prenom\s*du\s*client\s*unique/.test(n),
  },
  {
    key: "clientNom",
    match: (n) =>
      /\b(nom|name|lastname|family\s*name|nom\s*du\s*client|raison\s*sociale\s*acheteur)\b/.test(n) &&
      !/pr[eé]nom|prenom|nom\s*commercial|denomination|nom\s*de\s*jeune|nom\s*d\s*usage/.test(n) &&
      !/\bmarque\b/.test(n) &&
      !/modele|modèle|vehicule|véhicule|v[eé]hicule|prix|vin\b|chassis|châssis|designation|version|finition/.test(n),
  },
  {
    key: "clientAdresse",
    match: (n) => /adresse|address|lieu\s*dit|code\s*postal.*ville|ville.*cp/.test(n),
  },
  {
    key: "clientEmail",
    match: (n) => /e\s*mail|email|courriel|mail\b|@\s*\(/.test(n),
  },
  {
    key: "clientTelephone",
    match: (n) =>
      /telephone|t[eé]l|mobile|portable|gsm|phone|numero\s*de\s*tel|n\s*tel\b/.test(n),
  },
  {
    key: "ribIban",
    match: (n) => /\biban\b|iban\s*:/.test(n),
  },
  {
    key: "ribBic",
    match: (n) => /\bbic\b|swift/.test(n),
  },
  {
    key: "ribTitulaire",
    match: (n) => /titulaire.*compte|titulaire.*rib|nom.*titulaire|ordre\s*du\s*cheque/.test(n),
  },
  {
    key: "ribBanque",
    match: (n) => /nom.*banque|etablissement\s*banque|domiciliation/.test(n),
  },
  {
    key: "vehiculeVin",
    match: (n) =>
      /\bvin\b|chassis|châssis|n\s*chassis|numero\s*de\s*chassis|vehicule.*identification/.test(n),
  },
  {
    key: "vehiculeModele",
    match: (n) =>
      (/modele|modèle|type\s*vehicule|designation|version|finition|gamme/.test(n) ||
       /\bnom\b.*\b(vehicule|v[eé]hicule|modele|modèle)\b/.test(n) ||
       /\b(vehicule|v[eé]hicule|modele|modèle)\b.*\bnom\b/.test(n)) &&
      !/^\s*marque\s*$|champ\s*marque\s*$/.test(n) &&
      !(/\bmarque\b/.test(n) && !/modele|modèle|type|designation/.test(n)),
  },
  {
    key: "vehiculeKilometrage",
    match: (n) => /kilomet|kilom|km\b|odometre|odomètre/.test(n),
  },
  {
    key: "vehiculeCo2",
    match: (n) => /co2|g\/km|emission|pollution/.test(n),
  },
  {
    key: "vehiculeChevaux",
    match: (n) => /chevaux|cv\b|din|puissance\s*fiscale|puissance\s*reelle/.test(n),
  },
  {
    key: "vehiculePrix",
    match: (n) =>
      /prix\s*(de\s*)?vente|prix\s*vehicule|montant\s*ttc|prix\s*ttc|tarif|cout\s*vehicule/.test(n),
  },
  {
    key: "vehiculeCouleur",
    match: (n) => /couleur|coloris|teinte/.test(n),
  },
  {
    key: "vehiculeOptions",
    match: (n) => /options?\s*vehicule|equipements|packs?/.test(n),
  },
  {
    key: "vehiculeCarteGrise",
    match: (n) => /carte\s*grise|c\.g\.|certificat\s*d?\s*immatriculation|grey\s*card/.test(n),
  },
  {
    key: "vehiculeDateLivraison",
    match: (n) => /livraison|date\s*de\s*livraison|remise\s*des\s*cles/.test(n),
  },
  {
    key: "vehiculeReprise",
    match: (n) => /reprise\s*(ancien|vehicule|vp|vu)|valeur\s*de\s*reprise/.test(n),
  },
  {
    key: "vehiculeRemise",
    match: (n) =>
      /remise\s*(commerciale|sur\s*prix)|ristourne|discount|remise\s*exceptionnelle/.test(n),
  },
  {
    key: "vehiculeFraisReprise",
    match: (n) => /frais\s*de\s*reprise|frais\s*mise/.test(n),
  },
  {
    key: "acompte",
    match: (n) => /acompte|arrhes|depot\s*de\s*garantie/.test(n),
  },
  {
    key: "apport",
    match: (n) => /\bapport\b|apport\s*personnel/.test(n),
  },
  {
    key: "modePaiement",
    match: (n) => /mode\s*de\s*paiement|paiement\s*par|reglement/.test(n),
  },
  {
    key: "organismePreteur",
    match: (n) =>
      /organisme\s*(preteur|prêteur|credit|crédit)|etablissement\s*de\s*credit|banque\s*pret/.test(n),
  },
  {
    key: "montantCredit",
    match: (n) => /montant\s*(du\s*)?(credit|crédit|pret|prêt)|capital\s*emprunte/.test(n),
  },
  {
    key: "tauxCredit",
    match: (n) => /taux\s*(nominal|effectif|du\s*credit|du\s*prêt|d\s*interet|d\s*intérêt)/.test(n),
  },
  {
    key: "dureeMois",
    match: (n) => /duree\s*(en\s*)?(mois|mensualites)|nombre\s*de\s*mensualites/.test(n),
  },
  {
    key: "vehiculeFinancement",
    match: (n) => {
      if (
        /organisme|preteur|prêteur|montant\s*(du\s*)?(credit|crédit|prêt)|taux\s|duree\s|mensual/.test(n)
      ) {
        return false;
      }
      return (
        /mode\s*financement|type\s*financement|financement\s*vehicule|vehicule.*financement/.test(n) ||
        /achat\s*(au\s*)?comptant|comptant\s*ou\s*credit/.test(n) ||
        (/financement|crédit|credit|leasing|loa|lld/.test(n) && /vehicule|commande|bon|dossier/.test(n))
      );
    },
  },
  {
    key: "clauseSuspensive",
    match: (n) => /clause\s*suspensive|suspensif|condition\s*suspensive/.test(n),
  },
  {
    key: "vendeurNom",
    match: (n) => /vendeur|commercial|conseiller|representant/.test(n) && !/acheteur|client/.test(n),
  },
  {
    key: "vendeurNotes",
    match: (n) => /notes?\s*vendeur|commentaire\s*interne|remarques?\s*vente/.test(n),
  },
  {
    key: "optionsPrixTotal",
    match: (n) => /options?\s*prix\s*total|total\s*options|montant\s*options/.test(n),
  },
  {
    key: "optionsDetailJson",
    match: (n) => /detail\s*options|liste\s*options|options?\s*ligne/.test(n),
  },
];

function matchExtraFormKey(normalizedLabel: string, extraKeys: string[]): string | null {
  for (const key of extraKeys) {
    if (!key || typeof key !== "string") continue;
    const slug = normalizePdfFieldLabel(key.replace(/_/g, " "));
    if (slug.length < 2) continue;
    if (normalizedLabel.includes(slug)) return key;
    const compact = slug.replace(/\s/g, "");
    if (compact.length >= 3 && normalizedLabel.replace(/\s/g, "").includes(compact)) return key;
  }
  return null;
}

export type BuildMappingOptions = {
  /** Clés des champs véhicule personnalisés (vehicle_fields.field_key), ex. ["marque_atelier"] */
  extraFormKeys?: string[];
};

/**
 * Construit le field_mapping stocké en base : chaque nom de champ PDF → une clé applicative.
 * Champs PDF non reconnus : absents du résultat (pas de valeur injectée au remplissage).
 */
export function buildDeterministicFieldMapping(
  pdfFieldNames: string[],
  options: BuildMappingOptions = {}
): Record<string, string> {
  const extraKeys = Array.isArray(options.extraFormKeys)
    ? options.extraFormKeys.filter((k) => typeof k === "string" && k.trim())
    : [];
  const allowedStandard = new Set<string>(BON_DRAFT_KEYS as unknown as string[]);
  const out: Record<string, string> = {};

  for (const pdfName of pdfFieldNames) {
    if (!pdfName || typeof pdfName !== "string") continue;
    const n = normalizePdfFieldLabel(pdfName);
    if (!n) continue;

    let key: string | null = null;
    for (const rule of RULES) {
      if (rule.match(n)) {
        key = rule.key;
        break;
      }
    }

    if (!key && extraKeys.length > 0) {
      key = matchExtraFormKey(n, extraKeys);
    }

    if (!key) continue;
    if (allowedStandard.has(key) || extraKeys.includes(key)) {
      out[pdfName] = key;
    }
  }

  return out;
}

/**
 * Recherche d'un véhicule par plaque d'immatriculation.
 * Passe par le proxy serverless `/api/lookup-plate` pour :
 *   - contourner la politique CORS de l'API amont
 *   - cacher / centraliser le token d'authentification
 *   - normaliser les codes d'erreur
 */

export type PlateLookupData = {
  plaque: string;
  marque: string;
  modele: string;
  annee: string;
  premiere_circulation: string;
};

export type PlateLookupError =
  | "invalid_plate"
  | "not_found"
  | "rate_limit"
  | "upstream"
  | "network";

/**
 * NB : on volontairement n'utilise pas d'union discriminée pour contourner
 * un souci de narrowing rencontré avec tsc sur ce fichier. Les branches
 * passent toujours un `message` (vide en cas de succès) — le consommateur
 * discrimine via `ok`.
 */
export type PlateLookupResult = {
  ok: boolean;
  data: PlateLookupData | null;
  error: PlateLookupError | null;
  message: string;
};

const ERROR_MESSAGES: Record<PlateLookupError, string> = {
  invalid_plate:
    "Format de plaque invalide — utilisez par ex. AA-123-BB.",
  not_found:
    "Aucun véhicule trouvé pour cette plaque.",
  rate_limit:
    "Trop de requêtes — patientez quelques secondes avant de réessayer.",
  upstream:
    "Le service d'immatriculation est temporairement indisponible.",
  network:
    "Impossible de contacter le service — vérifiez votre connexion.",
};

/** Nettoyage visuel + validation rapide d'une plaque FR. */
export function cleanPlate(raw: string): string {
  return String(raw ?? "").toUpperCase().replace(/[\s\-_.]/g, "").trim();
}

/** Validation large : 4 à 10 caractères alphanumériques (AA123BB, 1234XY75, etc.). */
export function isPlateFormatValid(raw: string): boolean {
  return /^[A-Z0-9]{4,10}$/.test(cleanPlate(raw));
}

function failure(kind: PlateLookupError): PlateLookupResult {
  return { ok: false, data: null, error: kind, message: ERROR_MESSAGES[kind] };
}

export async function lookupByPlate(rawPlate: string): Promise<PlateLookupResult> {
  const plaque = cleanPlate(rawPlate);
  if (!isPlateFormatValid(plaque)) {
    return failure("invalid_plate");
  }

  let response: Response;
  try {
    response = await fetch(
      `/api/lookup-plate?plate=${encodeURIComponent(plaque)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
  } catch {
    return failure("network");
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // garde body vide
  }

  if (response.ok) {
    const data: PlateLookupData = {
      plaque: String(body.plaque ?? plaque),
      marque: String(body.marque ?? ""),
      modele: String(body.modele ?? ""),
      annee: String(body.annee ?? ""),
      premiere_circulation: String(body.premiere_circulation ?? ""),
    };
    return { ok: true, data, error: null, message: "" };
  }

  let kind: PlateLookupError = "upstream";
  switch (response.status) {
    case 400:
      kind = "invalid_plate";
      break;
    case 404:
      kind = "not_found";
      break;
    case 429:
      kind = "rate_limit";
      break;
    default:
      kind = "upstream";
  }
  return failure(kind);
}

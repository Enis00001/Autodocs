import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Proxy Vercel vers apiplaqueimmatriculation.com.
 *
 * Pourquoi un proxy ?
 *  - L'API amont n'expose pas les en-têtes CORS nécessaires pour un appel direct navigateur.
 *  - Permet d'injecter le token depuis la variable d'env `PLAQUE_API_TOKEN` et éviter
 *    qu'il ne fuite côté client.
 *  - Normalise les codes d'erreur (400 / 404 / 429 / 502).
 *  - Normalise le payload renvoyé au front (clés stables : marque, modele, annee,
 *    premiere_circulation, couleur, vin, co2, puissance).
 *
 * Requête : POST /api/plaque   body: { plaque: "AA-123-BB" }
 *
 * Réponses :
 *   200 { plaque, marque, modele, annee, premiere_circulation, couleur, vin, co2, puissance }
 *   400 { error: "invalid_plate" }
 *   404 { error: "not_found" }
 *   429 { error: "rate_limit" }
 *   500 { error: "missing_token" }   // si PLAQUE_API_TOKEN absent en prod
 *   502 { error: "upstream", detail }
 */

const UPSTREAM = "https://api.apiplaqueimmatriculation.com/plaque";

function cleanPlate(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[\s\-_.]/g, "").trim();
}

function pickString(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== "object") return "";
  for (const key of keys) {
    const v = (obj as Record<string, unknown>)[key];
    if (v != null && v !== "") return String(v).trim();
  }
  return "";
}

/** Extrait l'année d'une date ISO (YYYY-MM-DD) ou FR (DD/MM/YYYY). */
function extractYear(raw: string): string {
  if (!raw) return "";
  const isoMatch = raw.match(/^(\d{4})/);
  if (isoMatch) return isoMatch[1];
  const frMatch = raw.match(/(\d{4})$/);
  return frMatch ? frMatch[1] : "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Body peut arriver en JSON déjà parsé ou en string brute selon la plateforme.
  let body: Record<string, unknown> = {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body);
    } catch {
      return res.status(400).json({ error: "invalid_body" });
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as Record<string, unknown>;
  }

  const plaque = cleanPlate(body.plaque);
  if (!/^[A-Z0-9]{4,10}$/.test(plaque)) {
    return res.status(400).json({ error: "invalid_plate" });
  }

  const token = process.env.PLAQUE_API_TOKEN;
  if (!token) {
    console.error("[api/plaque] Missing PLAQUE_API_TOKEN env var");
    return res.status(500).json({ error: "missing_token" });
  }

  const params = new URLSearchParams({
    immatriculation: plaque,
    token,
    pays: "FR",
  });
  const url = `${UPSTREAM}?${params.toString()}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const upstream = await fetch(url, { method: "POST", signal: controller.signal });
    clearTimeout(timer);

    if (upstream.status === 429) {
      return res.status(429).json({ error: "rate_limit" });
    }

    const text = await upstream.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // réponse non-JSON : upstream en panne ou token invalide
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: "upstream", status: upstream.status, detail: text.slice(0, 400) });
    }

    // Certaines réponses placent les infos dans .data, d'autres à la racine.
    const root = (json && typeof json === "object" && "data" in (json as object)
      ? (json as { data: unknown }).data
      : json) ?? {};

    // Certaines APIs renvoient une erreur métier en HTTP 200 — on la détecte.
    const errField = pickString(root, ["error", "erreur", "message", "status", "statut"]).toLowerCase();
    const errorLike =
      errField.includes("not") ||
      errField.includes("introuv") ||
      errField.includes("invalid") ||
      errField.includes("erreur") ||
      errField.includes("ko");

    const marque = pickString(root, ["marque", "brand", "make"]);
    const modele = pickString(root, ["modele", "model"]);
    const date1erCirUs = pickString(root, ["date1erCir_us", "date1ercir_us", "firstRegistrationUs"]);
    const date1erCirFr = pickString(root, ["date1erCir_fr", "date1ercir_fr", "firstRegistrationFr", "date1erCir"]);
    const couleur = pickString(root, ["couleur", "color"]);
    const vin = pickString(root, ["vin", "numSerie", "numero_serie"]);
    const co2 = pickString(root, ["co2", "emissionCO2", "co2_emission"]);
    const puissance = pickString(root, ["puisFisc", "puissanceFiscale", "puissance_fiscale", "puissance"]);

    const annee = extractYear(date1erCirUs) || extractYear(date1erCirFr);
    const premiereCirculation = date1erCirFr || date1erCirUs;

    const nothingFound = !marque && !modele && !annee && !premiereCirculation && !vin;
    if (errorLike || nothingFound) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.status(200).json({
      plaque,
      marque,
      modele,
      annee,
      premiere_circulation: premiereCirculation,
      couleur,
      vin,
      co2,
      puissance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/plaque] Error:", message);
    return res.status(502).json({ error: "upstream", detail: message });
  }
}

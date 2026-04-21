import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Proxy léger vers apiplaqueimmatriculation.fr.
 *
 * Pourquoi un proxy ?
 *  - L'API amont n'expose pas les en-têtes CORS nécessaires pour un appel
 *    direct depuis le navigateur.
 *  - Permet d'injecter le token via env (fallback "essai" pour dev).
 *  - Normalise les erreurs (404 vs 429 vs 500) pour le client.
 *  - Normalise le format de la réponse (keys marque/modele/annee/premiere_circulation).
 *
 * Query params :
 *   plate=<string>  — plaque d'immatriculation (ex: AA123BB)
 *
 * Réponses :
 *   200 { marque, modele, annee, premiere_circulation, plaque }   → trouvé
 *   400 { error: "invalid_plate" }
 *   404 { error: "not_found" }
 *   429 { error: "rate_limit" }
 *   502 { error: "upstream", detail }
 */

const UPSTREAM = "https://api.apiplaqueimmatriculation.fr/getCarByPlate";

function cleanPlate(raw: string): string {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const rawPlate = typeof req.query.plate === "string" ? req.query.plate : "";
  const plate = cleanPlate(rawPlate);
  if (!/^[A-Z0-9]{4,10}$/.test(plate)) {
    return res.status(400).json({ error: "invalid_plate" });
  }

  const token = process.env.PLATE_API_TOKEN || "essai";
  const url = `${UPSTREAM}?plate=${encodeURIComponent(plate)}&token=${encodeURIComponent(token)}`;

  let upstreamStatus = 0;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    upstreamStatus = response.status;

    if (response.status === 429) {
      return res.status(429).json({ error: "rate_limit" });
    }

    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // upstream a répondu en texte non-JSON
    }

    if (!response.ok) {
      return res.status(502).json({ error: "upstream", status: response.status, detail: text.slice(0, 400) });
    }

    // Structure typique : { data: {...} } ou directement les champs à la racine
    const root =
      (json && typeof json === "object" && "data" in (json as object)
        ? (json as { data: unknown }).data
        : json) ?? {};

    const marque = pickString(root, ["brand", "make", "marque", "manufacturer"]);
    const modele = pickString(root, ["model", "modele", "model_name"]);
    const annee = pickString(root, ["year", "annee", "model_year", "year_of_manufacture"]);
    const premiereCirc = pickString(root, [
      "date_first_registration",
      "first_registration_date",
      "premiere_circulation",
      "date_mise_circulation",
      "first_registration",
    ]);

    // upstream peut aussi retourner une erreur "non trouvé" avec HTTP 200
    const errField = pickString(root, ["error", "message", "status"]).toLowerCase();
    const notFound =
      (!marque && !modele && !annee && !premiereCirc) ||
      errField.includes("not") ||
      errField.includes("introuv") ||
      errField.includes("invalid");

    if (notFound) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.status(200).json({
      plaque: plate,
      marque,
      modele,
      annee,
      premiere_circulation: premiereCirc,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lookup-plate] Error:", message, "upstream:", upstreamStatus);
    return res.status(502).json({ error: "upstream", detail: message });
  }
}

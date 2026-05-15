import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ==================================================================
 *  _lib inliné (supabase-admin, concession, relance, livre-police)
 *  Inliné pour éviter ERR_MODULE_NOT_FOUND sur Vercel ESM serverless.
 * ================================================================== */

/**
 * Helpers Supabase pour les routes API serverless (`api/*.ts`).
 *
 * Le préfixe `_` du dossier indique à Vercel de NE PAS déployer ce fichier
 * comme une fonction serverless ; il est seulement importable depuis les
 * autres routes via `import { ... } from "./_lib/supabase-admin.js"`.
 *
 * Important :
 *  - On NE lit JAMAIS de variables `VITE_*` côté serveur. Elles n'existent
 *    pas en runtime serverless (Vercel n'expose au front que ce qui est
 *    préfixé `VITE_` au build), et leur présence ici est trompeuse.
 *  - On garde un *fallback* pour `SUPABASE_URL` uniquement vers
 *    `VITE_SUPABASE_URL` parce que c'est *publique* (URL du projet) et
 *    pour conserver la compat avec les déploiements existants.
 *  - `SUPABASE_SERVICE_ROLE_KEY` est OBLIGATOIRE et n'a JAMAIS de fallback.
 */

const SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";

function getSupabaseUrlOrThrow(): string {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (!url) {
    throw new Error(
      "Configuration Supabase manquante : SUPABASE_URL n'est pas définie côté serveur (Vercel → Settings → Environment Variables).",
    );
  }
  return url;
}

function getSupabaseAnonKeyOrThrow(): string {
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!key) {
    throw new Error(
      "Configuration Supabase manquante : SUPABASE_ANON_KEY n'est pas définie côté serveur.",
    );
  }
  return key;
}

function getServiceRoleKeyOrThrow(): string {
  const key = process.env[SERVICE_ROLE_ENV];
  if (!key) {
    throw new Error(
      `Configuration Supabase manquante : ${SERVICE_ROLE_ENV} n'est pas définie côté serveur. Ajoutez-la dans Vercel → Settings → Environment Variables (Production + Preview), puis redéployez.`,
    );
  }
  if (key.startsWith("VITE_") || key.length < 50) {
    throw new Error(
      `${SERVICE_ROLE_ENV} semble invalide (longueur ${key.length}). Vérifiez que vous avez bien copié la "service_role" key depuis Supabase → Project Settings → API.`,
    );
  }
  return key;
}

/**
 * Client Supabase ADMIN (service_role) — bypass RLS.
 * À utiliser UNIQUEMENT depuis `api/*.ts`. Le throw est volontaire :
 * faire échouer la route avec un message lisible vaut mieux qu'un
 * `TypeError: Failed to fetch` côté client.
 */
async function getSupabaseAdmin(): Promise<SupabaseClient> {
  const url = getSupabaseUrlOrThrow();
  const key = getServiceRoleKeyOrThrow();
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client Supabase ANON (clé publique) — utile uniquement pour valider
 * un JWT utilisateur via `auth.getUser(token)`. NE PAS utiliser pour
 * lire/écrire des données sensibles depuis une route API.
 */
async function getSupabaseAuthClient(): Promise<SupabaseClient> {
  const url = getSupabaseUrlOrThrow();
  const anon = getSupabaseAnonKeyOrThrow();
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Extrait l'`auth.uid()` à partir du header `Authorization: Bearer <jwt>`.
 * Retourne `null` si l'en-tête est absent / le token invalide. NE THROW PAS :
 * laisser le caller décider si la route exige une auth ou non.
 */
async function getAuthUserId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!token) return null;
  try {
    const supabase = await getSupabaseAuthClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch (err) {
    console.error("[supabase-admin] getAuthUserId failed:", err);
    return null;
  }
}

const FALLBACK_APP_URL = "https://autodocs-eight.vercel.app";

/**
 * Calcule l'URL publique de l'app, dans cet ordre :
 *  1. `PUBLIC_APP_URL` (env var explicite — recommandé en prod)
 *  2. en-têtes `x-forwarded-host` / `host` de la requête (si dispo)
 *  3. `VERCEL_URL` (URL automatique du déploiement)
 *  4. fallback hardcodé.
 */
function getPublicAppUrl(req?: VercelRequest): string {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (req) {
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined);
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
    if (host) return `${proto}://${host}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  }

  return FALLBACK_APP_URL;
}

/** Concession active du compte (unique membre actif V1). */
async function getActiveConcessionIdForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("membres_concession")
    .select("concession_id")
    .eq("user_id", userId)
    .eq("actif", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[concession] getActiveConcessionIdForUser:", error);
    return null;
  }
  return (data?.concession_id as string | undefined) ?? null;
}

async function getMembreRoleForConcession(
  admin: SupabaseClient,
  userId: string,
  concessionId: string,
): Promise<"admin" | "commercial" | null> {
  const { data } = await admin
    .from("membres_concession")
    .select("role")
    .eq("user_id", userId)
    .eq("concession_id", concessionId)
    .eq("actif", true)
    .maybeSingle();
  if (!data?.role) return null;
  return data.role === "admin" ? "admin" : "commercial";
}

async function assertIsAdminOfConcession(
  admin: SupabaseClient,
  userId: string,
  concessionId: string,
): Promise<boolean> {
  const role = await getMembreRoleForConcession(admin, userId, concessionId);
  return role === "admin";
}


type BuildRelanceEmailPayload = {
  clientNom: string;
  clientPrenom: string;
  signatureUrl: string;
  expiresAt?: string | null;
  messagePersonnalise?: string | null;
  numeroRelance: 1 | 2;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiresAt(expiresAt?: string | null): string {
  if (!expiresAt) return "bientot";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "bientot";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function buildRelanceEmailHTML(payload: BuildRelanceEmailPayload): string {
  const clientNom = escapeHtml(payload.clientNom || "Client");
  const clientPrenom = escapeHtml(payload.clientPrenom || "");
  const fullName = `${clientPrenom} ${clientNom}`.trim();
  const expiresAtLabel = formatExpiresAt(payload.expiresAt);
  const messagePersonnalise = String(payload.messagePersonnalise ?? "").trim();
  const relanceLabel = payload.numeroRelance === 2 ? "2e rappel" : "1er rappel";

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p style="margin: 0 0 14px;">Bonjour ${fullName || "Client"},</p>
      <p style="margin: 0 0 12px;">
        Nous vous rappelons que votre bon de commande est en attente de votre signature.
      </p>
      <p style="margin: 0 0 12px; color: #59607a; font-size: 13px;">
        ${relanceLabel} de la concession.
      </p>
      ${
        messagePersonnalise
          ? `<div style="margin: 0 0 16px; padding: 12px 14px; background: #f5f7ff; border-left: 4px solid #2c3e8f; border-radius: 6px; color: #23263a;">
               ${escapeHtml(messagePersonnalise).replace(/\n/g, "<br>")}
             </div>`
          : ""
      }
      <div style="margin: 22px 0 18px;">
        <a href="${payload.signatureUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 7px; font-weight: 700;">
          SIGNER MON BON DE COMMANDE
        </a>
      </div>
      <p style="margin: 0 0 8px; color: #666;">
        Ce lien expire le <strong>${escapeHtml(expiresAtLabel)}</strong>.
      </p>
      <p style="margin: 0; color: #666; font-size: 12px;">
        Si le bouton ne fonctionne pas, copiez-collez ce lien :<br>
        <a href="${payload.signatureUrl}" style="color: #2c3e8f; word-break: break-all;">${payload.signatureUrl}</a>
      </p>
      <p style="margin: 18px 0 0;">
        Cordialement,<br>
        L'équipe AutoDocs
      </p>
    </div>
  `;
}


/* livre-police-template (ex api/_lib/livre-police-template.ts) */
/** Ligne issue de `livre_de_police` (PDF registre / fiche). */
type LivrePoliceEntreePdf = Record<string, unknown>;

function escapeHtmlLivreCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  if (s === "") return "—";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Lit la 1re clé présente (snake_case ou alias MAJUSCULE / CSV hérité). */
function pickRaw(e: LivrePoliceEntreePdf, ...keys: string[]): unknown {
  const rec = e as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
}

function strCell(e: LivrePoliceEntreePdf, ...keys: string[]): string {
  return escapeHtmlLivreCell(pickRaw(e, ...keys));
}

function fmtEuro(n: unknown): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "number" ? n : Number(String(n).replace(",", "."));
  if (!Number.isFinite(num)) return "—";
  return `${num.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

function fmtDateFr(d: unknown): string {
  if (!d) return "—";
  try {
    const iso = typeof d === "string" ? d : String(d);
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

function fmtKm(n: unknown): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("fr-FR");
}

function vendeurCell(e: LivrePoliceEntreePdf): { nom: string; idPiece: string } {
  const type = String(pickRaw(e, "vendeur_type", "VENDEUR_TYPE") ?? "particulier");
  if (type === "entreprise") {
    return {
      nom: strCell(e, "vendeur_entreprise_nom", "VENDEUR_ENTREPRISE_NOM"),
      idPiece: strCell(e, "vendeur_siret", "VENDEUR_SIRET"),
    };
  }
  const nomRaw = `${String(pickRaw(e, "vendeur_nom", "VENDEUR_NOM") ?? "").trim()} ${String(pickRaw(e, "vendeur_prenom", "VENDEUR_PRENOM") ?? "").trim()}`.trim();
  return {
    nom: escapeHtmlLivreCell(nomRaw || "—"),
    idPiece: strCell(e, "vendeur_numero_piece_identite", "VENDEUR_NUMERO_PIECE_IDENTITE"),
  };
}

function acheteurCell(e: LivrePoliceEntreePdf): { nom: string; idPiece: string } {
  const type = String(pickRaw(e, "acheteur_type", "ACHETEUR_TYPE") ?? "particulier");
  if (type === "entreprise") {
    return {
      nom: strCell(e, "acheteur_entreprise_nom", "ACHETEUR_ENTREPRISE_NOM"),
      idPiece: strCell(e, "acheteur_siret", "ACHETEUR_SIRET"),
    };
  }
  const nomRaw =
    `${String(pickRaw(e, "acheteur_nom", "ACHETEUR_NOM") ?? "").trim()} ${String(pickRaw(e, "acheteur_prenom", "ACHETEUR_PRENOM") ?? "").trim()}`.trim();
  return {
    nom: escapeHtmlLivreCell(nomRaw || "—"),
    idPiece: strCell(e, "acheteur_numero_piece_identite", "ACHETEUR_NUMERO_PIECE_IDENTITE"),
  };
}

function buildLivrePoliceHTML(
  entrees: LivrePoliceEntreePdf[] | null | undefined,
  concession: { nom?: string | null; siret?: string | null } | null | undefined,
): string {
  const rows = Array.isArray(entrees) ? entrees : [];
  console.log("buildLivrePoliceHTML - nb entrees:", rows.length);
  console.log("buildLivrePoliceHTML - premiere entree:", rows[0]);
  const bodyRows =
    rows.length > 0
      ? rows
          .map((e) => {
            const v = vendeurCell(e);
            const a = acheteurCell(e);
            const modeAchat = pickRaw(e, "mode_reglement", "mode_reglement_achat", "MODE_REGLEMENT");
            const modeVente = pickRaw(e, "mode_reglement_vente", "mode_reglement", "MODE_REGLEMENT_VENTE");
            return `
        <tr>
          <td>${escapeHtmlLivreCell(pickRaw(e, "numero_ordre", "NUMERO_ORDRE"))}</td>
          <td>${fmtDateFr(pickRaw(e, "date_entree", "DATE_ENTREE"))}</td>
          <td>${strCell(e, "genre", "GENRE")}</td>
          <td>${strCell(e, "marque", "MARQUE")}</td>
          <td>${strCell(e, "modele", "MODELE")}</td>
          <td>${strCell(e, "type_variante_version", "TYPE_VARIANTE_VERSION", "TVV")}</td>
          <td>${strCell(e, "couleur", "COULEUR")}</td>
          <td>${strCell(e, "annee_mise_en_circulation", "ANNEE_MISE_EN_CIRCULATION", "1ERE_MEC")}</td>
          <td>${fmtKm(pickRaw(e, "kilometrage", "KILOMETRAGE", "KM"))}</td>
          <td>${strCell(e, "immatriculation", "IMMAT", "IMMATRICULATION")}</td>
          <td>${strCell(e, "vin", "VIN", "N° DE SERIE")}</td>
          <td>${(() => {
            const p = pickRaw(e, "pays_origine", "PAYS_ORIGINE");
            if (p == null || (typeof p === "string" && !String(p).trim())) return escapeHtmlLivreCell("France");
            return escapeHtmlLivreCell(p);
          })()}</td>
          <td>${v.nom}</td>
          <td>${v.idPiece}</td>
          <td>${fmtEuro(pickRaw(e, "prix_achat", "PRIX_ACHAT"))}</td>
          <td>${escapeHtmlLivreCell(modeAchat)}</td>
          <td>${a.nom}</td>
          <td>${a.idPiece}</td>
          <td>${fmtEuro(pickRaw(e, "prix_vente", "PRIX_VENTE"))}</td>
          <td>${escapeHtmlLivreCell(modeVente)}</td>
          <td>${fmtDateFr(pickRaw(e, "date_sortie", "DATE_SORTIE"))}</td>
          <td>${strCell(e, "destination_sortie", "DESTINATION_SORTIE")}</td>
        </tr>`;
          })
          .join("")
      : '<tr><td colspan="22">Aucune entrée</td></tr>';

  const nomConc = escapeHtmlLivreCell(concession?.nom?.trim() || "Concession");
  const siret = escapeHtmlLivreCell(concession?.siret?.trim() || "—");
  const edite = new Date().toLocaleDateString("fr-FR");

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; font-size: 8px; }
    h1 { font-size: 14px; text-align: center; }
    .header { text-align: center; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #1e3a5f; color: white;
      padding: 4px; font-size: 7px;
      border: 1px solid #ccc;
    }
    td {
      padding: 3px; border: 1px solid #ddd;
      font-size: 7px; vertical-align: top;
    }
    tr:nth-child(even) { background: #f9f9f9; }
    .mention {
      margin-top: 20px; font-size: 7px;
      color: #666; text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>LIVRE DE POLICE — REGISTRE DES VÉHICULES D'OCCASION</h1>
    <p><strong>${nomConc}</strong> — SIRET : ${siret}</p>
    <p>Édité le ${escapeHtmlLivreCell(edite)}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th>N°</th>
        <th>Date entrée</th>
        <th>Genre</th>
        <th>Marque</th>
        <th>Modèle</th>
        <th>TVV</th>
        <th>Couleur</th>
        <th>1ère MEC</th>
        <th>KM</th>
        <th>Immat</th>
        <th>VIN</th>
        <th>Pays</th>
        <th>Vendeur</th>
        <th>N° ID vendeur</th>
        <th>Prix achat</th>
        <th>Règlement achat</th>
        <th>Acheteur</th>
        <th>N° ID acheteur</th>
        <th>Prix vente</th>
        <th>Règlement vente</th>
        <th>Date sortie</th>
        <th>Destination</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>

  <div class="mention">
    Document conforme aux obligations légales du livre de police automobile (Article L321-1 du Code de la Sécurité Intérieure).
    Ce registre doit être conservé 5 ans après la dernière inscription.
  </div>
</body>
</html>`;
}

/* ==================================================================
 *  Bon-template inliné (ex api/_lib/bon-template.ts)
 *  Inliné pour éviter ERR_MODULE_NOT_FOUND sur Vercel ESM serverless.
 * ================================================================== */

const BON_TEMPLATE_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 15mm 18mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a2e; line-height: 1.45; }
  .page { width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2c3e8f; padding-bottom: 14px; margin-bottom: 18px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .logo-placeholder { width: 54px; height: 54px; border: 2px dashed #c8cde0; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #9ea3b8; font-size: 9px; text-align: center; line-height: 1.1; }
  .concession-block h1 { font-size: 18px; font-weight: 800; color: #2c3e8f; letter-spacing: -0.3px; }
  .concession-block .subtitle { font-size: 10px; color: #666; margin-top: 2px; }
  .header-right { text-align: right; font-size: 10px; color: #555; }
  .header-right .ref { font-size: 13px; font-weight: 700; color: #2c3e8f; }
  .header-right .doc-title { font-size: 16px; font-weight: 800; color: #1a1a2e; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .section { margin-bottom: 14px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #fff; background: #2c3e8f; padding: 6px 10px; }
  table { width: 100%; border-collapse: collapse; }
  table td, table th { padding: 5px 8px; border: 1px solid #d0d4e4; font-size: 10.5px; vertical-align: top; }
  table th { background: #eef0f8; font-weight: 600; color: #333; text-align: left; width: 38%; white-space: nowrap; }
  .reglement { border: 1px solid #d0d4e4; padding: 10px 12px; }
  .reglement-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
  .reglement-row.negative .value { color: #b34242; }
  .reglement-row .value { font-weight: 600; }
  .reglement-row.net { font-weight: 800; font-size: 13px; background: #eef0f8; padding: 6px 10px; margin: 4px -2px; border: 2px solid #2c3e8f; }
  .reglement-row.solde { font-weight: 800; font-size: 12px; border-top: 1px dashed #c0c5d8; padding-top: 6px; margin-top: 2px; }
  .mode-pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 10px; font-weight: 700; background: #2c3e8f; color: #fff; letter-spacing: 0.4px; text-transform: uppercase; }
  .signatures { display: flex; gap: 20px; margin-top: 20px; }
  .sig-box { flex: 1; border: 1px solid #d0d4e4; padding: 10px; min-height: 90px; }
  .sig-box .sig-title { font-size: 10px; font-weight: 700; color: #2c3e8f; margin-bottom: 4px; }
  .sig-box .sig-name { font-size: 10px; margin-bottom: 4px; }
  .sig-box .sig-date { font-size: 9px; color: #888; margin-top: 6px; }
  .sig-zone { min-height: 80px; border: 1px dashed #ccc; margin-top: 8px; position: relative; padding: 4px; display: flex; align-items: center; justify-content: center; }
  .sig-zone img { max-width: 200px; max-height: 80px; display: block; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #d0d4e4; font-size: 8.5px; color: #888; text-align: center; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <div class="logo-placeholder">LOGO</div>
      <div class="concession-block">
        <h1>{{concessionNom}}</h1>
        <div class="subtitle">Véhicule d'occasion / neuf</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-title">Bon de commande</div>
      <div class="ref">N° {{bonNumero}}</div>
      <div>Date : {{bonDate}}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Acheteur</div>
    <table>
      <tr>
        <th>Nom</th><td>{{clientNom}}</td>
        <th>Prénom</th><td>{{clientPrenom}}</td>
      </tr>
      <tr>
        <th>Date de naissance</th><td colspan="3">{{clientDateNaissance}}</td>
      </tr>
    </table>
  </div>

  <!--VEHICULE_SECTION_START-->
  <div class="section">
    <div class="section-title">Véhicule vendu</div>
    <table>
      {{vehiculeRowsHtml}}
    </table>
  </div>
  <!--VEHICULE_SECTION_END-->

  <!--REPRISE_SECTION_START-->
  <div class="section">
    <div class="section-title">Reprise véhicule</div>
    <table>
      <tr>
        <th>Véhicule repris</th>
        <td colspan="3">{{reprise_marque}} {{reprise_modele}} — Plaque : <strong>{{reprise_plaque}}</strong></td>
      </tr>
      <tr>
        <th>N° VIN / Châssis</th>
        <td colspan="3">{{reprise_vin}}</td>
      </tr>
      <tr>
        <th>Première circulation</th>
        <td colspan="3">{{reprise_premiere_circulation}}</td>
      </tr>
      <tr>
        <th>Valeur de reprise déduite</th>
        <td colspan="3"><strong style="color:#b34242;">- {{reprise_valeur}} €</strong></td>
      </tr>
      <!--REPRISE_DUREE_ROW_START-->
      <tr>
        <th>Durée</th>
        <td colspan="3">{{reprise_duree_mois}} mois</td>
      </tr>
      <!--REPRISE_DUREE_ROW_END-->
    </table>
  </div>
  <!--REPRISE_SECTION_END-->

  <div class="section">
    <div class="section-title">Règlement</div>
    <div class="reglement">
      <div class="reglement-row">
        <span>Prix véhicule TTC</span>
        <span class="value">{{vehiculePrix}} €</span>
      </div>
      <!--REMISE_ROW_START-->
      <div class="reglement-row negative">
        <span>Remise accordée</span>
        <span class="value">- {{vehiculeRemise}} €</span>
      </div>
      <!--REMISE_ROW_END-->
      <!--REPRISE_ROW_START-->
      <div class="reglement-row negative">
        <span>Reprise véhicule ancien</span>
        <span class="value">- {{reprise_valeur}} €</span>
      </div>
      <!--REPRISE_ROW_END-->
      <div class="reglement-row net">
        <span>Net à payer TTC</span>
        <span class="value">{{netAPayer}} €</span>
      </div>
      <!--ACOMPTE_BLOCK_START-->
      <div class="reglement-row">
        <span>Acompte versé</span>
        <span class="value">- {{acompte}} €</span>
      </div>
      <div class="reglement-row solde">
        <span>Solde restant dû à la livraison</span>
        <span class="value">{{solde}} €</span>
      </div>
      <!--ACOMPTE_BLOCK_END-->
      <div class="reglement-row" style="margin-top: 10px;">
        <span>Mode de paiement</span>
        <span class="mode-pill">{{modePaiementLabel}}</span>
      </div>
      <div class="reglement-row">
        <span>Date de livraison prévue</span>
        <span class="value">{{vehiculeDateLivraison}}</span>
      </div>
    </div>
  </div>
  <!--CUSTOM_FIELDS_SECTION_START-->
  <div class="section">
    <div class="section-title">Champs personnalisés</div>
    <table>
      {{customFieldsRowsHtml}}
    </table>
  </div>
  <!--CUSTOM_FIELDS_SECTION_END-->

  <div class="signatures">
    <div class="sig-box" id="zone-signature-client">
      <div class="sig-title">L'acheteur</div>
      <div class="sig-name">{{clientPrenom}} {{clientNom}}</div>
      <div style="font-size: 9px; color: #666;">Lu et approuvé, bon pour accord</div>
      <div class="sig-zone">{{signature_client}}</div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
    <div class="sig-box" id="zone-signature-vendeur">
      <div class="sig-title">Le vendeur</div>
      <div class="sig-name">{{concessionNom}}</div>
      <div style="font-size: 9px; color: #666;">Cachet & signature</div>
      <div class="sig-zone">{{signature_vendeur}}</div>
      <div class="sig-date">Date : {{bonDate}}</div>
    </div>
  </div>

  <div class="footer">
    Ce bon de commande constitue un engagement ferme et définitif entre les parties, sous réserve des conditions suspensives éventuellement indiquées.
    Conformément aux articles L. 221-18 et suivants du Code de la consommation, l'acheteur dispose d'un délai de rétractation de 14 jours pour les ventes à distance.
  </div>

</div>
</body>
</html>`;

type SignatureImages = {
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
};

function escapeHtmlTemplate(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseNum(s: string): number {
  const n = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickStockField(donnees: Record<string, string>, aliases: string[]): string {
  if (!donnees || typeof donnees !== "object") return "";
  const lower = aliases.map((a) => a.toLowerCase());
  for (const alias of lower) {
    const exact = Object.keys(donnees).find((k) => k.toLowerCase() === alias);
    if (exact) {
      const v = String(donnees[exact] ?? "").trim();
      if (v) return v;
    }
  }
  for (const alias of lower) {
    const partial = Object.keys(donnees).find((k) => k.toLowerCase().includes(alias));
    if (partial) {
      const v = String(donnees[partial] ?? "").trim();
      if (v) return v;
    }
  }
  return "";
}

function normalizeVehiculeKey(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_.-]/g, "");
}

function extractVehiculeField(
  donnees: Record<string, unknown>,
  synonymes: string[],
): string {
  if (!donnees || typeof donnees !== "object") return "";

  for (const synonyme of synonymes) {
    const direct = donnees[synonyme];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      return String(direct).trim();
    }
  }

  const normalizedWanted = new Set(synonymes.map((s) => normalizeVehiculeKey(s)));
  for (const [key, value] of Object.entries(donnees)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    if (normalizedWanted.has(normalizeVehiculeKey(key))) {
      return String(value).trim();
    }
  }

  for (const [key, value] of Object.entries(donnees)) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const normalized = normalizeVehiculeKey(key);
    if (
      normalized.includes("mec") ||
      normalized.includes("miseencirculation") ||
      (normalized.includes("immatriculation") && normalized.includes("date"))
    ) {
      return String(value).trim();
    }
  }

  return "";
}

function extractPremiereMiseEnCirculation(donnees: Record<string, unknown>): string {
  return (
    extractVehiculeField(donnees, [
      "mec",
      "MEC",
      "M.E.C",
      "m.e.c",
      "1ere_mec",
      "1ère_mec",
      "1ere mec",
      "1ère mec",
      "1ere_mise_en_circulation",
      "1ère_mise_en_circulation",
      "premiere_mise_en_circulation",
      "première_mise_en_circulation",
      "premiere mise en circulation",
      "première mise en circulation",
      "date_mise_en_circulation",
      "date mise en circulation",
      "date_mec",
      "date mec",
      "mise_en_circulation",
      "mise en circulation",
      "1er_mise_en_circulation",
      "date_immatriculation",
      "date immatriculation",
      "annee_mise_en_circulation",
      "année mise en circulation",
      "date_1ere_immat",
      "date_premiere_immat",
      "1ere_immat",
      "1ère immat",
      "immat_date",
      "DateMEC",
      "dateMEC",
      "Date MEC",
      "Date M.E.C",
      "Date 1ère MEC",
      "1ère mise en circulation",
      "1ere mise en circulation",
      "premieremiseencirculation",
    ]) || "Non renseignée"
  );
}

/* facture-template (ex api/_lib/facture-template.ts) */
type PrestationFacture = { libelle: string; prix_ht: number };

function formatMoneyFr(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type FactureTemplatePayload = {
  numero_facture: string;
  date_facture_label: string;

  concession_nom: string;
  concession_siret: string;
  concession_adresse: string;
  concession_telephone: string;
  concession_email: string;
  concession_tva_intra: string;

  client_nom: string;
  client_prenom: string;
  client_adresse: string;
  client_email: string;
  client_telephone: string;

  vehicule_marque: string;
  vehicule_modele: string;
  vehicule_version: string;
  vehicule_type: string;
  vehicule_premiere_circulation: string;
  vehicule_kilometrage: string;
  vehicule_km_non_garanti: boolean;
  vehicule_vin: string;
  vehicule_immatriculation: string;
  vehicule_couleur: string;
  vehicule_energie: string;
  vehicule_donnees?: Record<string, unknown>;

  prestations: PrestationFacture[];

  prix_ht_vehicule_label: string;
  prix_ht_prestations_label: string;
  prix_ht_total_label: string;
  tva_taux_label: string;
  tva_montant_label: string;
  prix_ttc_label: string;
  acompte_label: string;
  reprise_montant_label: string;
  reprise_description: string;
  reste_a_payer_label: string;

  mention_garantie_vente: string;
  notes: string;
};

function buildFactureHtml(p: FactureTemplatePayload): string {
  const vehiculeDonnees = p.vehicule_donnees ?? {};
  const resolvedPremiereCirculation =
    String(p.vehicule_premiere_circulation ?? "").trim() ||
    extractPremiereMiseEnCirculation(vehiculeDonnees);
  const resolvedKilometrage =
    String(p.vehicule_kilometrage ?? "").trim() ||
    extractVehiculeField(vehiculeDonnees, [
      "km",
      "kilometrage",
      "kilométrage",
      "kms",
      "kilometre",
      "kilomètres",
      "nb_km",
      "compteur",
    ]);
  const resolvedVin =
    String(p.vehicule_vin ?? "").trim() ||
    extractVehiculeField(vehiculeDonnees, [
      "vin",
      "VIN",
      "numero_serie",
      "numéro de série",
      "n_serie",
      "serie",
      "chassis",
      "châssis",
      "n_chassis",
    ]);
  const resolvedImmat =
    String(p.vehicule_immatriculation ?? "").trim() ||
    extractVehiculeField(vehiculeDonnees, [
      "immat",
      "immatriculation",
      "plaque",
      "numero_immat",
      "n_immat",
      "plaque_immat",
    ]);
  const resolvedEnergie =
    String(p.vehicule_energie ?? "").trim() ||
    extractVehiculeField(vehiculeDonnees, [
      "energie",
      "énergie",
      "carburant",
      "motorisation",
      "type_energie",
      "fuel",
      "combustible",
    ]);
  const resolvedCouleur =
    String(p.vehicule_couleur ?? "").trim() ||
    extractVehiculeField(vehiculeDonnees, ["couleur", "color", "teinte", "coloris"]);

  const prestRows =
    p.prestations.length === 0
      ? `<tr><td colspan="2" style="padding:8px;border:1px solid #ccc;color:#666;font-style:italic;">Aucune prestation supplémentaire</td></tr>`
      : p.prestations
          .map(
            (pr) =>
              `<tr><td style="padding:6px 8px;border:1px solid #ccc;">${escapeHtmlTemplate(pr.libelle)}</td>` +
              `<td style="padding:6px 8px;border:1px solid #ccc;text-align:right;white-space:nowrap;">${escapeHtmlTemplate(formatMoneyFr(pr.prix_ht))} €</td></tr>`,
          )
          .join("");

  const notesBlock =
    (p.notes ?? "").trim().length > 0
      ? `<div class="notes-box"><strong>Notes</strong><br/>${escapeHtmlTemplate(p.notes.trim()).replace(/\n/g, "<br/>")}</div>`
      : "";

  const repriseBlock =
    parseFloat(String(p.reprise_montant_label).replace(/\s/g, "").replace(",", ".")) > 0
      ? `<div class="price-row"><span>Reprise déduite</span><span>− ${escapeHtmlTemplate(p.reprise_montant_label)} €</span></div>
         ${(p.reprise_description ?? "").trim() ? `<div class="reprise-desc">${escapeHtmlTemplate(p.reprise_description.trim())}</div>` : ""}`
      : "";
  const acompteBlock =
    parseFloat(String(p.acompte_label).replace(/\s/g, "").replace(",", ".")) > 0
      ? `<div class="price-row"><span>Acompte versé</span><span>− ${escapeHtmlTemplate(p.acompte_label)} €</span></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: A4; margin: 14mm 12mm 14mm 12mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
    font-size: 10.5px;
    color: #111;
    line-height: 1.45;
    position: relative;
  }
  .watermark {
    position: fixed;
    top: 42%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 64px;
    font-weight: 800;
    color: #000;
    opacity: 0.045;
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }
  .wrap { position: relative; z-index: 1; }
  .doc-title {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 2px;
    text-align: right;
    margin-bottom: 4px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid #000;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .concession h1 { font-size: 15px; font-weight: 800; margin-bottom: 4px; }
  .concession .small { font-size: 9px; color: #333; line-height: 1.35; }
  .meta { text-align: right; font-size: 10px; }
  .meta .num { font-size: 13px; font-weight: 800; margin-bottom: 4px; }
  .section { margin-bottom: 10px; }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: #000;
    color: #fff;
    padding: 4px 8px;
    margin-bottom: 0;
  }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th, table.grid td {
    border: 1px solid #ccc;
    padding: 5px 8px;
    font-size: 10px;
    vertical-align: top;
  }
  table.grid th {
    background: #f4f4f4;
    font-weight: 600;
    width: 22%;
    white-space: nowrap;
  }
  .price-box {
    border: 1px solid #000;
    padding: 10px 12px;
    margin-top: 8px;
  }
  .price-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    font-size: 10.5px;
  }
  .price-row.emphasis { font-weight: 700; font-size: 11px; border-top: 1px dashed #999; margin-top: 6px; padding-top: 8px; }
  .reste-box {
    margin-top: 10px;
    border: 3px double #000;
    padding: 10px 12px;
    text-align: center;
    font-weight: 800;
    font-size: 14px;
  }
  .reste-box span { display: block; font-size: 10px; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 1px; }
  .legal {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #ccc;
    font-size: 8.5px;
    color: #222;
    line-height: 1.45;
  }
  .legal p { margin-bottom: 6px; }
  .legal strong { font-weight: 700; }
  .notes-box { margin-top: 8px; padding: 8px; border: 1px dashed #999; font-size: 9px; }
  .reprise-desc { font-size: 9px; color: #444; margin-top: 4px; font-style: italic; }
</style>
</head>
<body>
<div class="watermark">AutoDocs</div>
<div class="wrap">

  <div class="doc-title">FACTURE</div>

  <div class="header">
    <div class="concession">
      <h1>${escapeHtmlTemplate(p.concession_nom)}</h1>
      <div class="small">
        ${escapeHtmlTemplate(p.concession_adresse)}<br/>
        Tél. ${escapeHtmlTemplate(p.concession_telephone)} — ${escapeHtmlTemplate(p.concession_email)}<br/>
        SIRET : ${escapeHtmlTemplate(p.concession_siret)} — TVA intracom. : ${escapeHtmlTemplate(p.concession_tva_intra)}
      </div>
    </div>
    <div class="meta">
      <div class="num">N° ${escapeHtmlTemplate(p.numero_facture)}</div>
      <div>Date de facture : <strong>${escapeHtmlTemplate(p.date_facture_label)}</strong></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Client (acheteur)</div>
    <table class="grid">
      <tr><th>Nom</th><td>${escapeHtmlTemplate(p.client_nom)}</td><th>Prénom</th><td>${escapeHtmlTemplate(p.client_prenom)}</td></tr>
      <tr><th>Adresse</th><td colspan="3">${escapeHtmlTemplate(p.client_adresse)}</td></tr>
      <tr><th>Email</th><td>${escapeHtmlTemplate(p.client_email)}</td><th>Téléphone</th><td>${escapeHtmlTemplate(p.client_telephone)}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Détail du véhicule</div>
    <table class="grid">
      <tr><th>Marque</th><td>${escapeHtmlTemplate(p.vehicule_marque)}</td><th>Type / genre</th><td>${escapeHtmlTemplate(p.vehicule_type)}</td></tr>
      <tr><th>Modèle</th><td>${escapeHtmlTemplate(p.vehicule_modele)}</td><th>Version</th><td>${escapeHtmlTemplate(p.vehicule_version)}</td></tr>
      <tr><th>1ère mise en circulation</th><td colspan="3">${escapeHtmlTemplate(resolvedPremiereCirculation || "Non renseignée")}</td></tr>
      <tr><th>Kilométrage</th><td colspan="3">${p.vehicule_km_non_garanti ? "<strong>Non garanti</strong>" : escapeHtmlTemplate(resolvedKilometrage || "Non renseigné")}</td></tr>
      <tr><th>N° VIN (numéro de série)</th><td colspan="3">${escapeHtmlTemplate(resolvedVin || "Non renseigné")}</td></tr>
      <tr><th>N° d'immatriculation</th><td>${escapeHtmlTemplate(resolvedImmat || "Non renseignée")}</td><th>Couleur</th><td>${escapeHtmlTemplate(resolvedCouleur || "Non renseignée")}</td></tr>
      <tr><th>Énergie</th><td colspan="3">${escapeHtmlTemplate(resolvedEnergie || "Non renseignée")}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Prestations supplémentaires (hors véhicule)</div>
    <table class="grid">
      <tr style="background:#f4f4f4;font-weight:700;"><td style="border:1px solid #ccc;">Libellé</td><td style="border:1px solid #ccc;width:120px;text-align:right;">Prix HT</td></tr>
      ${prestRows}
    </table>
  </div>

  <div class="price-box">
    <div class="price-row"><span>Prix HT véhicule</span><span>${escapeHtmlTemplate(p.prix_ht_vehicule_label)} €</span></div>
    <div class="price-row"><span>Total HT prestations</span><span>${escapeHtmlTemplate(p.prix_ht_prestations_label)} €</span></div>
    <div class="price-row emphasis"><span>Total HT</span><span>${escapeHtmlTemplate(p.prix_ht_total_label)} €</span></div>
    <div class="price-row"><span>TVA (${escapeHtmlTemplate(p.tva_taux_label)} %)</span><span>${escapeHtmlTemplate(p.tva_montant_label)} €</span></div>
    <div class="price-row emphasis"><span>Total TTC</span><span>${escapeHtmlTemplate(p.prix_ttc_label)} €</span></div>
    ${acompteBlock}
    ${repriseBlock}
    <div class="reste-box">
      <span>Net à payer TTC</span>
      ${escapeHtmlTemplate(p.reste_a_payer_label)} €
    </div>
  </div>

  ${notesBlock}

  <div class="legal">
    <p><strong>Conditions de vente et mentions légales</strong></p>
    <p>${escapeHtmlTemplate(p.mention_garantie_vente)}</p>
    <p>Le vendeur déclare que le véhicule est <strong>libre de tout gage et opposition</strong> au jour de la vente.</p>
    <p>Les <strong>pièces administratives</strong> nécessaires à la circulation et à la revente ont été ou seront <strong>remises à l'acheteur</strong> conformément à la réglementation applicable.</p>
    <p><strong>Garantie légale de conformité</strong> : pour les acheteurs qualifiés de consommateurs, le véhicule bénéficie de la garantie légale de conformité prévue aux articles L. 217-3 et suivants du Code de la consommation, dans les conditions fixées par le décret n° 2021-609 du 19 mai 2021 et les textes subséquents.</p>
    <p>${p.vehicule_km_non_garanti ? "Le kilométrage est indiqué <strong>sans garantie</strong> au moment de la vente." : "Le vendeur déclare que le <strong>kilométrage indiqué est exact</strong> au moment de la vente."}</p>
    <p><strong>Conservation du document</strong> : ce document doit être conservé <strong>10 ans</strong> par le vendeur et l'acheteur aux fins notamment de justification fiscale et de garanties.</p>
  </div>

</div>
</body>
</html>`;
}


function isoDateToFr(iso: string | undefined | null): string {
  const s = String(iso ?? "").trim();
  if (!s) return "—";
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  return s;
}

function stripBlock(html: string, startMarker: string, endMarker: string): string {
  const re = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, "g");
  return html.replace(re, "");
}

function keepBlock(html: string, startMarker: string, endMarker: string): string {
  return html
    .replace(new RegExp(startMarker, "g"), "")
    .replace(new RegExp(endMarker, "g"), "");
}

function parseJsonMaybe<T = unknown>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as T;
  return null;
}

function parseStringArray(raw: unknown): string[] {
  const v = parseJsonMaybe<unknown>(raw);
  const source = Array.isArray(v) ? v : Array.isArray(raw) ? raw : [];
  return (source as unknown[]).filter(
    (x): x is string => typeof x === "string" && x.trim() !== "",
  );
}

function parseStringDict(raw: unknown): Record<string, string> {
  const v = parseJsonMaybe<unknown>(raw);
  const source =
    v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!source) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(source)) {
    if (typeof k !== "string" || !k) continue;
    if (val === null || val === undefined) continue;
    out[k] = String(val);
  }
  return out;
}

function buildVehiculeRowsHtml(
  donnees: Record<string, string>,
  colonnes: string[],
): string {
  const rows: string[] = [];
  const order = colonnes.length > 0 ? colonnes : Object.keys(donnees);
  for (const key of order) {
    const rawValue = donnees[key];
    if (rawValue === undefined || rawValue === null) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    rows.push(
      `<tr><th>${escapeHtmlTemplate(key)}</th><td colspan="3">${escapeHtmlTemplate(value)}</td></tr>`,
    );
  }
  return rows.join("\n");
}

function buildCustomFieldsRowsHtml(
  defs: Array<Record<string, unknown>>,
  values: Record<string, string>,
): string {
  const sectionLabel: Record<string, string> = {
    client: "Client",
    vehicule: "Véhicule",
    reprise: "Reprise",
    reglement: "Règlement",
  };
  const rows: string[] = [];
  for (const def of defs) {
    const key = String(def.key ?? "");
    const label = String(def.label ?? "").trim();
    const section = String(def.section ?? "");
    const enabled = Boolean(def.enabled);
    const isCustom = Boolean(def.isCustom);
    if (!enabled || !isCustom || !key || !label) continue;
    const v = String(values[key] ?? "").trim();
    if (!v) continue;
    rows.push(
      `<tr><th>${escapeHtmlTemplate(sectionLabel[section] ?? section)} — ${escapeHtmlTemplate(label)}</th><td colspan="3">${escapeHtmlTemplate(v)}</td></tr>`,
    );
  }
  return rows.join("\n");
}

function buildSignatureImg(rawBase64: string | undefined): string {
  const trimmed = String(rawBase64 ?? "").trim();
  if (!trimmed) return "";
  const src = /^data:image\//i.test(trimmed)
    ? trimmed
    : `data:image/png;base64,${trimmed.replace(/^data:[^,]+,/, "")}`;
  return `<img src="${src}" alt="signature" style="max-width:200px;max-height:80px;" />`;
}

function buildHtml(
  formData: Record<string, string>,
  signatures: SignatureImages = {},
): string {
  let html = BON_TEMPLATE_HTML;

  const get = (key: string) => escapeHtmlTemplate((formData[key] ?? "").trim());

  const today = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const bonNumero =
    String(formData.bonNumero ?? "").trim() ||
    `BC-${Date.now().toString(36).toUpperCase()}`;

  const prix = parseNum(formData.vehiculePrix);
  const remise = parseNum(formData.vehiculeRemise);
  const repriseValeur = parseNum(formData.reprise_valeur);
  const repriseActive = repriseValeur > 0;
  const netAPayer = Math.max(0, prix);
  const acompte = parseNum(formData.acompte);
  const solde = Math.max(0, prix - acompte);

  const repriseDureeMoisRaw = (formData.reprise_duree_mois ?? "").trim();
  const hasRepriseDuree = repriseDureeMoisRaw !== "" && parseNum(repriseDureeMoisRaw) > 0;

  if (repriseActive) {
    html = keepBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = keepBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
    if (hasRepriseDuree) {
      html = keepBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
    } else {
      html = stripBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
    }
  } else {
    html = stripBlock(html, "<!--REPRISE_SECTION_START-->", "<!--REPRISE_SECTION_END-->");
    html = stripBlock(html, "<!--REPRISE_ROW_START-->", "<!--REPRISE_ROW_END-->");
    html = stripBlock(html, "<!--REPRISE_DUREE_ROW_START-->", "<!--REPRISE_DUREE_ROW_END-->");
  }

  if (remise > 0) {
    html = keepBlock(html, "<!--REMISE_ROW_START-->", "<!--REMISE_ROW_END-->");
  } else {
    html = stripBlock(html, "<!--REMISE_ROW_START-->", "<!--REMISE_ROW_END-->");
  }

  if (acompte > 0) {
    html = keepBlock(html, "<!--ACOMPTE_BLOCK_START-->", "<!--ACOMPTE_BLOCK_END-->");
  } else {
    html = stripBlock(html, "<!--ACOMPTE_BLOCK_START-->", "<!--ACOMPTE_BLOCK_END-->");
  }

  const donnees = parseStringDict(formData.stock_donnees);
  const colonnes = parseStringArray(formData.stock_colonnes);
  const vehiculeRowsHtml = buildVehiculeRowsHtml(donnees, colonnes);
  const customDefs =
    parseJsonMaybe<Array<Record<string, unknown>>>(formData.custom_fields_defs) ?? [];
  const customValues = parseStringDict(formData.custom_fields_values);
  const customFieldsRowsHtml = buildCustomFieldsRowsHtml(customDefs, customValues);

  if (vehiculeRowsHtml.trim().length > 0) {
    html = keepBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--VEHICULE_SECTION_START-->", "<!--VEHICULE_SECTION_END-->");
  }
  if (customFieldsRowsHtml.trim().length > 0) {
    html = keepBlock(html, "<!--CUSTOM_FIELDS_SECTION_START-->", "<!--CUSTOM_FIELDS_SECTION_END-->");
  } else {
    html = stripBlock(html, "<!--CUSTOM_FIELDS_SECTION_START-->", "<!--CUSTOM_FIELDS_SECTION_END-->");
  }

  const modeRaw = (formData.modePaiement ?? "").trim().toLowerCase();
  const modePaiementLabel = modeRaw === "financement" ? "Financement" : "Comptant";

  const concessionNom =
    get("concessionNom") || escapeHtmlTemplate(process.env.CONCESSION_NOM ?? "") || "Concession";

  const signatureVendeurHtml = buildSignatureImg(signatures.signatureVendeurBase64);
  const signatureClientHtml = buildSignatureImg(signatures.signatureClientBase64);

  const replacements: Record<string, string> = {
    concessionNom,
    bonNumero,
    bonDate: today,

    clientNom: get("clientNom"),
    clientPrenom: get("clientPrenom"),
    clientDateNaissance: get("clientDateNaissance"),
    clientNumeroCni: get("clientNumeroCni"),
    /** Email / adresse acheteur : non imprimés sur le bon (réservés facture & CRM). */
    clientAdresse: "",

    vehiculePrix: formatMoney(prix),

    reprise_plaque: get("reprise_plaque"),
    reprise_marque: get("reprise_marque"),
    reprise_modele: get("reprise_modele"),
    reprise_vin: get("reprise_vin"),
    reprise_premiere_circulation: get("reprise_premiere_circulation"),
    reprise_valeur: formatMoney(repriseValeur),
    reprise_duree_mois: get("reprise_duree_mois"),

    vehiculeRemise: formatMoney(remise),
    netAPayer: formatMoney(netAPayer),
    acompte: formatMoney(acompte),
    solde: formatMoney(solde),
    modePaiementLabel,
    vehiculeDateLivraison: get("vehiculeDateLivraison"),
  };

  html = html.replace(/\{\{vehiculeRowsHtml\}\}/g, vehiculeRowsHtml);
  html = html.replace(/\{\{customFieldsRowsHtml\}\}/g, customFieldsRowsHtml);
  html = html.replace(/\{\{signature_vendeur\}\}/g, signatureVendeurHtml);
  html = html.replace(/\{\{signature_client\}\}/g, signatureClientHtml);

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "—");
  }

  html = html.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "—");

  return html;
}

async function renderPdfFromHtml(
  html: string,
  options?: {
    landscape?: boolean;
    margin?: { top: string; bottom: string; left: string; right: string };
  },
): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const margin = options?.margin ?? {
      top: "10mm",
      right: "10mm",
      bottom: "10mm",
      left: "10mm",
    };

    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: options?.landscape === true,
      printBackground: true,
      margin,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

type SendPdfEmailBody = {
  pdfBase64?: string;
  clientEmail?: string;
  clientNom?: string;
  clientPrenom?: string;
  vehiculeModele?: string;
  vendeurNom?: string;
  vendeurEmail?: string;
  brouillonId?: string;
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
};

type EmbedSignatureBody = {
  formData?: Record<string, string>;
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
  pdfBase64?: string;
  signatureBase64?: string;
};

type CompleteSignatureBody = {
  token?: string;
  signatureBase64?: string;
};

type ResendBody = {
  brouillonId?: string;
  token?: string;
};

type SendRelancesBody = {
  concession_id?: string;
  /** Si renseigné : n’envoie la relance suivante que pour ce brouillon (sans filtre délai). */
  brouillon_id?: string;
};

type SaveRelancesConfigBody = {
  concession_id?: string;
  actif?: unknown;
  delai_premier_rappel?: unknown;
  delai_deuxieme_rappel?: unknown;
  message_personnalise?: unknown;
};

type GenerateBriefingBody = {
  concession_id?: string;
};

function parseRequestBody(req: VercelRequest): Record<string, unknown> | null {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === "object") {
    return req.body as Record<string, unknown>;
  }
  return {};
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function authUserExistsByEmail(
  admin: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  email: string,
): Promise<boolean> {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;
  const maxPages = 50;
  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[actions] authUserExistsByEmail listUsers:", error);
      return false;
    }
    const batch = data.users ?? [];
    for (const u of batch) {
      if (u.email?.toLowerCase() === target) return true;
    }
    if (batch.length < perPage) break;
    page += 1;
  }
  return false;
}

function generateToken(): string {
  return crypto.randomUUID();
}

async function handleSendEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const body = data as SendPdfEmailBody;
  const pdfBase64 = String(body.pdfBase64 ?? "").trim();
  const clientEmail = String(body.clientEmail ?? "").trim();
  const clientNom = String(body.clientNom ?? "").trim();
  const clientPrenom = String(body.clientPrenom ?? "").trim();
  const vehiculeModele = String(body.vehiculeModele ?? "").trim() || "Véhicule";
  const vendeurNom = String(body.vendeurNom ?? "").trim() || "Votre conseiller";
  const vendeurEmail = String(body.vendeurEmail ?? "").trim();
  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const formData =
    body.formData && typeof body.formData === "object" ? body.formData : {};
  const signatureVendeurBase64 = String(body.signatureVendeurBase64 ?? "").trim();

  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 requis" });
  if (!clientEmail || !isValidEmail(clientEmail)) {
    return res.status(400).json({ error: "clientEmail invalide" });
  }

  const userId = await getAuthUserId(req);

  let concessionIdForSig: string | null = null;
  try {
    if (userId) {
      const adm = await getSupabaseAdmin();
      concessionIdForSig = await getActiveConcessionIdForUser(adm, userId);
    }
  } catch (err) {
    console.warn("[actions/send-email] concession lookup:", err);
  }

  let signatureToken: string | null = null;
  let expiresAtIso: string | null = null;
  try {
    const admin = await getSupabaseAdmin();
    signatureToken = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    expiresAtIso = expiresAt.toISOString();

    const { error } = await admin.from("signature_requests").insert({
      token: signatureToken,
      brouillon_id: brouillonId,
      user_id: userId,
      concession_id: concessionIdForSig,
      client_email: clientEmail,
      client_nom: clientNom || null,
      client_prenom: clientPrenom || null,
      vendeur_email: vendeurEmail || null,
      vendeur_nom: vendeurNom,
      vehicule_modele: vehiculeModele,
      pdf_base64: pdfBase64,
      form_data: formData,
      signature_vendeur: signatureVendeurBase64 || null,
      expires_at: expiresAtIso,
    });

    if (error) {
      console.error("[actions/send-email] insert signature_requests:", error);
      signatureToken = null;
      expiresAtIso = null;
    }
  } catch (err) {
    console.error("[actions/send-email] supabase admin error:", err);
    signatureToken = null;
    expiresAtIso = null;
  }

  const appUrl = getPublicAppUrl(req);
  const signUrl = signatureToken ? `${appUrl}/signer/${signatureToken}` : null;

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const subject = `Votre bon de commande — ${vehiculeModele}`;
  const greeting = `Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},`.replace(
    /\s+,$/,
    ",",
  );

  const signCta = signUrl
    ? `
    <div style="margin: 22px 0; padding: 18px; background: #eef0f8; border-left: 4px solid #2c3e8f; border-radius: 6px;">
      <p style="margin: 0 0 12px; font-weight: 600; color: #1a1a2e;">
        Signature électronique
      </p>
      <p style="margin: 0 0 14px; color: #444;">
        Pour signer votre bon de commande, cliquez sur le lien ci-dessous :
      </p>
      <p style="margin: 0 0 8px;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="margin: 8px 0 0; font-size: 12px; color: #666;">
        Ou copiez-collez ce lien dans votre navigateur :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a><br>
        <span style="color: #888;">Ce lien est valable 7 jours.</span>
      </p>
    </div>`
    : "";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>${greeting}</p>
      <p>Veuillez trouver ci-joint votre bon de commande pour le véhicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.
      </p>
      ${signCta}
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html,
      attachments: [
        {
          filename: "bon-de-commande.pdf",
          content: pdfBase64,
        },
      ],
    });

    if (error) {
      return res.status(500).json({ error: error.message || "Echec d'envoi email" });
    }

    return res.status(200).json({
      ok: true,
      signatureRequest: signatureToken
        ? {
            token: signatureToken,
            signUrl,
            expiresAt: expiresAtIso,
          }
        : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }
}

async function handleEmbedSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as EmbedSignatureBody;

  if (body.pdfBase64 && !body.formData) {
    return res.status(400).json({
      error:
        "Contrat obsolète : envoyez `formData` + `signatureVendeurBase64` pour permettre l'incrustation HTML.",
    });
  }

  const formData = body.formData;
  const signatureVendeurBase64 =
    body.signatureVendeurBase64?.trim() || body.signatureBase64?.trim() || "";
  const signatureClientBase64 = body.signatureClientBase64?.trim() || "";

  if (!formData || typeof formData !== "object") {
    return res.status(400).json({ error: "formData requis" });
  }
  if (!signatureVendeurBase64 && !signatureClientBase64) {
    return res
      .status(400)
      .json({ error: "Au moins une signature (vendeur ou client) est requise." });
  }

  try {
    const html = buildHtml(formData, {
      signatureVendeurBase64,
      signatureClientBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    const pdfBase64 = pdfBuffer.toString("base64");
    return res.status(200).json({ pdfBase64 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Echec de l'incrustation de la signature dans le PDF";
    console.error("[actions/embed-signature] error:", err);
    return res.status(500).json({ error: message });
  }
}

async function handleCompleteSignature(data: Record<string, unknown>, res: VercelResponse) {
  const body = data as CompleteSignatureBody;
  const token = String(body.token ?? "").trim();
  const signatureBase64 = String(body.signatureBase64 ?? "").trim();

  if (!token) return res.status(400).json({ error: "token requis" });
  if (!signatureBase64) {
    return res.status(400).json({ error: "signatureBase64 requis" });
  }

  const admin = await getSupabaseAdmin();
  const { data: request, error: readError } = await admin
    .from("signature_requests")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (readError) {
    console.error("[actions/complete-signature] read error:", readError);
    return res.status(500).json({ error: "Erreur de lecture" });
  }
  if (!request) {
    return res.status(404).json({ error: "Demande de signature introuvable" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }
  if (request.expires_at && new Date(request.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Lien de signature expire" });
  }

  let signedPdfBase64: string;
  try {
    const formData =
      request.form_data && typeof request.form_data === "object"
        ? (request.form_data as Record<string, string>)
        : {};
    const html = buildHtml(formData, {
      signatureVendeurBase64: request.signature_vendeur ?? undefined,
      signatureClientBase64: signatureBase64,
    });
    const pdfBuffer = await renderPdfFromHtml(html);
    signedPdfBase64 = pdfBuffer.toString("base64");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erreur lors de la generation du PDF signe";
    console.error("[actions/complete-signature] render error:", err);
    return res.status(500).json({ error: message });
  }

  const signedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("signature_requests")
    .update({
      signature_client: signatureBase64,
      signed_at: signedAt,
      pdf_base64: signedPdfBase64,
    })
    .eq("token", token);

  if (updateError) {
    console.error("[actions/complete-signature] update error:", updateError);
    return res.status(500).json({ error: "Erreur d'enregistrement" });
  }

  if (request.brouillon_id) {
    try {
      const { data: existing } = await admin
        .from("brouillons")
        .select("vehicle_field_values")
        .eq("id", request.brouillon_id)
        .maybeSingle();

      const currentKv =
        existing?.vehicle_field_values && typeof existing.vehicle_field_values === "object"
          ? (existing.vehicle_field_values as Record<string, unknown>)
          : {};

      await admin
        .from("brouillons")
        .update({
          vehicle_field_values: {
            ...currentKv,
            client_signed_at: signedAt,
          },
          updated_at: signedAt,
        })
        .eq("id", request.brouillon_id);
    } catch (err) {
      console.warn("[actions/complete-signature] brouillon update failed:", err);
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[actions/complete-signature] RESEND_API_KEY manquante — emails non envoyés");
    return res.status(200).json({
      ok: true,
      signedAt,
      pdfBase64: signedPdfBase64,
      emails: { client: false, vendeur: false, concession: false },
    });
  }

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const clientEmail = String(request.client_email ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const vendeurEmail = String(request.vendeur_email ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";
  const fullClientName = `${clientPrenom} ${clientNom}`.trim() || clientEmail;

  const subject = `Bon de commande signe — ${vehiculeModele}`;
  const attachments = [
    {
      filename: "bon-de-commande-signe.pdf",
      content: signedPdfBase64,
    },
  ];

  const clientHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Merci pour votre signature. Vous trouverez en piece jointe votre
        <strong>bon de commande signe</strong> pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Conservez ce document : il fait foi entre vous et la concession.</p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  const vendeurHtml = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour,</p>
      <p>Le client <strong>${escapeHtml(fullClientName)}</strong> a signe
        electroniquement le bon de commande pour le vehicule
        <strong>${escapeHtml(vehiculeModele)}</strong>.</p>
      <p>Le PDF final, comportant les deux signatures, est joint a cet email.</p>
      <p>— L'equipe AutoDocs</p>
    </div>
  `;

  const emailResults = { client: false, vendeur: false, concession: false };

  try {
    const { error: clientErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject,
      html: clientHtml,
      attachments,
    });
    if (!clientErr) emailResults.client = true;
    else console.error("[actions/complete-signature] email client error:", clientErr);
  } catch (err) {
    console.error("[actions/complete-signature] email client exception:", err);
  }

  if (vendeurEmail) {
    try {
      const { error: vendeurErr } = await resend.emails.send({
        from,
        to: vendeurEmail,
        subject: `Bon signe par ${fullClientName} — ${vehiculeModele}`,
        html: vendeurHtml,
        attachments,
      });
      if (!vendeurErr) emailResults.vendeur = true;
      else console.error("[actions/complete-signature] email vendeur error:", vendeurErr);
    } catch (err) {
      console.error("[actions/complete-signature] email vendeur exception:", err);
    }
  }

  // ---------------------------------------------------------------------------
  //  Envoi à la concession (compte AUTH propriétaire du brouillon)
  //
  //  Indépendant de `vendeur_email` (champ texte parfois absent dans la
  //  signature_request). On résout l'email côté serveur via :
  //      brouillon_id → brouillons.user_id → auth.users.email.
  //
  //  Ce bloc est isolé dans son propre try/catch : si l'envoi échoue, on
  //  loggue mais on ne fait pas échouer la requête (la signature est
  //  déjà persistée et le client a déjà été notifié).
  // ---------------------------------------------------------------------------
  try {
    let concessionUserId: string | null = null;

    if (request.brouillon_id) {
      const { data: brouillon, error: brouillonErr } = await admin
        .from("brouillons")
        .select("user_id")
        .eq("id", request.brouillon_id)
        .maybeSingle();
      if (brouillonErr) {
        console.warn(
          "[actions/complete-signature] brouillon read for concession email:",
          brouillonErr,
        );
      } else if (brouillon?.user_id) {
        concessionUserId = brouillon.user_id as string;
      }
    }

    // Fallback : signature_requests.user_id (rempli au moment du send-email).
    if (!concessionUserId && request.user_id) {
      concessionUserId = request.user_id as string;
    }

    if (!concessionUserId) {
      console.warn(
        "[actions/complete-signature] aucun user_id concession trouvé — email concession ignoré",
      );
    } else {
      const { data: userData, error: userErr } =
        await admin.auth.admin.getUserById(concessionUserId);
      const concessionEmail = String(userData?.user?.email ?? "").trim();

      if (userErr) {
        console.warn(
          "[actions/complete-signature] auth.admin.getUserById:",
          userErr.message,
        );
      } else if (!concessionEmail) {
        console.warn(
          "[actions/complete-signature] email concession introuvable pour user_id:",
          concessionUserId,
        );
      } else if (
        emailResults.vendeur &&
        vendeurEmail.toLowerCase() === concessionEmail.toLowerCase()
      ) {
        // Doublon : déjà envoyé via vendeurEmail (même adresse). On considère
        // l'email concession comme "envoyé" et on persiste le timestamp.
        emailResults.concession = true;
        try {
          await admin
            .from("signature_requests")
            .update({ email_concession_sent_at: new Date().toISOString() })
            .eq("token", token);
        } catch (markErr) {
          console.warn(
            "[actions/complete-signature] update email_concession_sent_at (dedup):",
            markErr,
          );
        }
      } else {
        const concessionSubject = `✅ Bon de commande signé — ${fullClientName || "Client"}`;
        const signedDateLabel = new Date(signedAt).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const concessionHtml = `
          <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
            <p>Bonjour,</p>
            <p>Le client <strong>${escapeHtml(fullClientName)}</strong> vient de signer
              électroniquement le bon de commande pour le véhicule
              <strong>${escapeHtml(vehiculeModele)}</strong>
              le <strong>${escapeHtml(signedDateLabel)}</strong>.</p>
            <p>Vous trouverez en pièce jointe le <strong>PDF final</strong> comportant
              les deux signatures (vendeur + client). Conservez ce document : il fait
              foi entre votre concession et le client.</p>
            <p>— L'équipe AutoDocs</p>
          </div>
        `;

        const { error: concessionErr } = await resend.emails.send({
          from,
          to: concessionEmail,
          subject: concessionSubject,
          html: concessionHtml,
          attachments,
        });

        if (concessionErr) {
          console.error(
            "[actions/complete-signature] email concession error:",
            concessionErr,
          );
        } else {
          emailResults.concession = true;
          try {
            await admin
              .from("signature_requests")
              .update({ email_concession_sent_at: new Date().toISOString() })
              .eq("token", token);
          } catch (markErr) {
            console.warn(
              "[actions/complete-signature] update email_concession_sent_at:",
              markErr,
            );
          }
        }
      }
    }
  } catch (err) {
    console.error("[actions/complete-signature] email concession exception:", err);
  }

  return res.status(200).json({
    ok: true,
    signedAt,
    pdfBase64: signedPdfBase64,
    emails: emailResults,
  });
}

async function handleResendSignatureEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorise" });
  }

  const body = data as ResendBody;
  const brouillonId = String(body.brouillonId ?? "").trim() || null;
  const tokenInput = String(body.token ?? "").trim() || null;

  if (!brouillonId && !tokenInput) {
    return res.status(400).json({ error: "brouillonId ou token requis" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const admin = await getSupabaseAdmin();
  const query = admin
    .from("signature_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokenInput) query.eq("token", tokenInput);
  else if (brouillonId) query.eq("brouillon_id", brouillonId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("[actions/resend-signature-email] read error:", error);
    return res.status(500).json({ error: "Erreur de lecture" });
  }

  const request = rows?.[0];
  if (!request) {
    return res.status(404).json({ error: "Aucune demande de signature trouvee" });
  }
  if (request.signed_at) {
    return res.status(409).json({ error: "Deja signe" });
  }

  let token = String(request.token);
  let expiresAt = request.expires_at;
  const isExpired = expiresAt && new Date(expiresAt).getTime() < Date.now();

  if (isExpired) {
    token = crypto.randomUUID();
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: insertError } = await admin.from("signature_requests").insert({
      token,
      brouillon_id: request.brouillon_id,
      user_id: userId,
      client_email: request.client_email,
      client_nom: request.client_nom,
      client_prenom: request.client_prenom,
      vendeur_email: request.vendeur_email,
      vendeur_nom: request.vendeur_nom,
      vehicule_modele: request.vehicule_modele,
      pdf_base64: request.pdf_base64,
      form_data: request.form_data,
      signature_vendeur: request.signature_vendeur,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error("[actions/resend-signature-email] insert error:", insertError);
      return res.status(500).json({ error: "Impossible de regenerer le lien" });
    }
  }

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const appUrl = getPublicAppUrl(req);
  const signUrl = `${appUrl}/signer/${token}`;

  const clientEmail = String(request.client_email ?? "").trim();
  const clientPrenom = String(request.client_prenom ?? "").trim();
  const clientNom = String(request.client_nom ?? "").trim();
  const vendeurNom = String(request.vendeur_nom ?? "").trim() || "Votre conseiller";
  const vehiculeModele = String(request.vehicule_modele ?? "").trim() || "Véhicule";

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px;">
      <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
      <p>Pour rappel, voici le lien permettant de signer votre bon de commande
         pour le vehicule <strong>${escapeHtml(vehiculeModele)}</strong> :</p>
      <p style="margin: 18px 0;">
        <a href="${signUrl}"
           style="display: inline-block; background: #2c3e8f; color: #fff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600;">
          Signer le bon de commande
        </a>
      </p>
      <p style="font-size: 12px; color: #666;">
        Lien valable 7 jours :<br>
        <a href="${signUrl}" style="color: #2c3e8f; word-break: break-all;">${signUrl}</a>
      </p>
      <p>Cordialement,<br>${escapeHtml(vendeurNom)}</p>
    </div>
  `;

  try {
    const { error: emailErr } = await resend.emails.send({
      from,
      to: clientEmail,
      subject: `Rappel : signature du bon de commande — ${vehiculeModele}`,
      html,
      attachments: request.pdf_base64
        ? [{ filename: "bon-de-commande.pdf", content: request.pdf_base64 }]
        : undefined,
    });
    if (emailErr) {
      return res.status(500).json({ error: emailErr.message || "Echec d'envoi email" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Echec d'envoi email";
    return res.status(500).json({ error: message });
  }

  return res.status(200).json({
    ok: true,
    token,
    signUrl,
    expiresAt,
  });
}

async function handleSaveRelancesConfig(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Non autorise" });
  }

  const body = data as SaveRelancesConfigBody;
  const admin = await getSupabaseAdmin();
  const activeConcessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!activeConcessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  const bodyCid = String(body.concession_id ?? "").trim();
  if (bodyCid && bodyCid !== activeConcessionId) {
    return res.status(403).json({ error: "Concession invalide." });
  }

  if (!(await assertIsAdminOfConcession(admin, userId, activeConcessionId))) {
    return res.status(403).json({ error: "Reserve aux administrateurs de la concession." });
  }

  const actif = Boolean(body.actif);
  const delai_premier_rappel = Math.max(0, Number(body.delai_premier_rappel ?? 3));
  const delai_deuxieme_rappel = Math.max(0, Number(body.delai_deuxieme_rappel ?? 7));
  const message_personnalise =
    typeof body.message_personnalise === "string" && body.message_personnalise.trim() !== ""
      ? body.message_personnalise.trim()
      : null;

  const { data: existing, error: selErr } = await admin
    .from("relances_config")
    .select("id")
    .eq("concession_id", activeConcessionId)
    .maybeSingle();

  if (selErr) {
    console.error("[actions/save-relances-config] select:", selErr);
    return res.status(500).json({ error: selErr.message ?? "Erreur lecture relances." });
  }

  const updatedAt = new Date().toISOString();

  if (existing?.id) {
    const { error: upErr } = await admin
      .from("relances_config")
      .update({
        actif,
        delai_premier_rappel,
        delai_deuxieme_rappel,
        message_personnalise,
        updated_at: updatedAt,
      })
      .eq("concession_id", activeConcessionId);
    if (upErr) {
      console.error("[actions/save-relances-config] update:", upErr);
      return res.status(500).json({ error: upErr.message ?? "Erreur mise a jour relances." });
    }
  } else {
    const { error: insErr } = await admin.from("relances_config").insert({
      concession_id: activeConcessionId,
      actif,
      delai_premier_rappel,
      delai_deuxieme_rappel,
      message_personnalise,
    });
    if (insErr) {
      console.error("[actions/save-relances-config] insert:", insErr);
      return res.status(500).json({ error: insErr.message ?? "Erreur creation relances." });
    }
  }

  return res.status(200).json({ ok: true });
}

async function handleSendRelances(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const body = data as SendRelancesBody;
  console.log("send-relances body:", body);

  const targetedBrouillonId =
    typeof body.brouillon_id === "string" ? body.brouillon_id.trim() : "";
  const concessionFilter = String(body.concession_id ?? "").trim() || null;

  const admin = await getSupabaseAdmin();
  const resend = new Resend(apiKey);
  const appUrl = getPublicAppUrl(req);
  const now = new Date();

  type RelanceSrRow = {
    id: string;
    token?: string | null;
    expires_at?: string | null;
    brouillon_id?: string | null;
    client_email?: string | null;
    client_nom?: string | null;
    client_prenom?: string | null;
    form_data?: unknown;
    relance_1_sent_at?: string | null;
    relance_2_sent_at?: string | null;
  };

  type RelancesConfigForMail = {
    message_personnalise?: string | null;
  };

  const sendRelanceMailForRow = async (
    sr: RelanceSrRow,
    configRow: RelancesConfigForMail,
    numero: 1 | 2,
  ): Promise<boolean> => {
    const token = String(sr.token ?? "").trim();
    if (!token) return false;

    let brouillonForm: Record<string, unknown> = {};
    if (sr.brouillon_id) {
      const { data: brouillon, error: brOneErr } = await admin
        .from("brouillons")
        .select("form_data")
        .eq("id", sr.brouillon_id)
        .maybeSingle();
      if (brOneErr) {
        console.warn("[actions/send-relances] brouillon form_data:", brOneErr);
      }
      if (brouillon?.form_data && typeof brouillon.form_data === "object") {
        brouillonForm = brouillon.form_data as Record<string, unknown>;
      }
    }

    const srForm =
      sr.form_data && typeof sr.form_data === "object"
        ? (sr.form_data as Record<string, unknown>)
        : {};
    const formData = { ...brouillonForm, ...srForm };

    const clientEmail =
      String(sr.client_email ?? "").trim() ||
      String(formData.email ?? "").trim() ||
      String(formData.clientEmail ?? "").trim() ||
      String(formData.emailClient ?? "").trim() ||
      String(formData.client_email ?? "").trim();

    const clientNom =
      String(sr.client_nom ?? "").trim() ||
      String(formData.nom ?? "").trim() ||
      String(formData.clientNom ?? "").trim() ||
      String(formData.client_nom ?? "").trim() ||
      "Client";

    const clientPrenom =
      String(sr.client_prenom ?? "").trim() ||
      String(formData.prenom ?? "").trim() ||
      String(formData.clientPrenom ?? "").trim() ||
      String(formData.client_prenom ?? "").trim() ||
      "";

    console.log("Client trouvé:", { clientEmail, clientNom, clientPrenom });

    if (!clientEmail || !isValidEmail(clientEmail)) {
      console.log("Pas d'email pour brouillon:", sr.brouillon_id);
      return false;
    }

    const signatureUrl = `${appUrl}/signer/${token}`;
    try {
      const { error: mailErr } = await resend.emails.send({
        from: "AutoDocs <noreply@autodocs.services>",
        to: clientEmail,
        subject: "Rappel : votre bon de commande attend votre signature",
        html: buildRelanceEmailHTML({
          clientNom,
          clientPrenom,
          signatureUrl,
          expiresAt: sr.expires_at,
          messagePersonnalise: String(configRow.message_personnalise ?? ""),
          numeroRelance: numero,
        }),
      });
      if (mailErr) {
        console.error(
          numero === 1
            ? "[actions/send-relances] relance1 email:"
            : "[actions/send-relances] relance2 email:",
          mailErr,
        );
        return false;
      }
      const markField =
        numero === 1
          ? { relance_1_sent_at: now.toISOString() }
          : { relance_2_sent_at: now.toISOString() };
      const { error: markErr } = await admin
        .from("signature_requests")
        .update(markField)
        .eq("id", sr.id);
      if (markErr) {
        console.error(
          numero === 1
            ? "[actions/send-relances] relance1 mark:"
            : "[actions/send-relances] relance2 mark:",
          markErr,
        );
        return false;
      }
      return true;
    } catch (err) {
      console.error(
        numero === 1
          ? "[actions/send-relances] relance1 exception:"
          : "[actions/send-relances] relance2 exception:",
        err,
      );
      return false;
    }
  };

  if (targetedBrouillonId) {
    if (!concessionFilter) {
      return res
        .status(400)
        .json({ error: "concession_id requis pour une relance ciblée." });
    }

    const { data: brRow, error: brErr } = await admin
      .from("brouillons")
      .select("id, concession_id")
      .eq("id", targetedBrouillonId)
      .maybeSingle();

    if (brErr) {
      console.error("[actions/send-relances] targeted brouillon:", brErr);
      return res.status(500).json({ error: "Impossible de vérifier le bon." });
    }
    if (!brRow) {
      return res.status(404).json({ error: "Bon introuvable." });
    }
    if (String(brRow.concession_id ?? "").trim() !== concessionFilter) {
      return res.status(403).json({ error: "Bon non autorisé pour cette concession." });
    }

    const { data: cfgRow } = await admin
      .from("relances_config")
      .select("message_personnalise")
      .eq("concession_id", concessionFilter)
      .maybeSingle();

    const configForSend: RelancesConfigForMail = {
      message_personnalise: cfgRow?.message_personnalise ?? null,
    };

    const { data: srs, error: srErr } = await admin
      .from("signature_requests")
      .select(
        "id, token, expires_at, brouillon_id, client_email, client_nom, client_prenom, form_data, created_at, relance_1_sent_at, relance_2_sent_at",
      )
      .eq("brouillon_id", targetedBrouillonId)
      .is("signed_at", null)
      .order("created_at", { ascending: false });

    if (srErr) {
      console.error("[actions/send-relances] targeted signature_requests:", srErr);
      return res
        .status(500)
        .json({ error: "Impossible de lire la demande de signature." });
    }

    const sr = (srs?.[0] ?? undefined) as RelanceSrRow | undefined;
    if (!sr) {
      return res.status(200).json({ sent: 0 });
    }

    let sentTargeted = 0;
    if (!sr.relance_1_sent_at) {
      if (await sendRelanceMailForRow(sr, configForSend, 1)) sentTargeted = 1;
    } else if (!sr.relance_2_sent_at) {
      if (await sendRelanceMailForRow(sr, configForSend, 2)) sentTargeted = 1;
    }

    return res.status(200).json({ sent: sentTargeted });
  }

  const configQuery = admin
    .from("relances_config")
    .select(
      "concession_id, actif, delai_premier_rappel, delai_deuxieme_rappel, message_personnalise",
    )
    .eq("actif", true);

  if (concessionFilter) configQuery.eq("concession_id", concessionFilter);

  const { data: configs, error: cfgErr } = await configQuery;
  if (cfgErr) {
    console.error("[actions/send-relances] config read:", cfgErr);
    return res.status(500).json({ error: "Impossible de lire la configuration des relances." });
  }
  if (!configs || configs.length === 0) {
    return res.status(200).json({ sent: 0 });
  }

  let sent = 0;

  for (const config of configs) {
    const concessionId = String(config.concession_id ?? "").trim();
    if (!concessionId) continue;

    console.log("config trouvée:", config);

    const premierDelai = Math.max(
      1,
      Math.round(Number(String(config.delai_premier_rappel ?? "3").trim()) || 3),
    );
    const deuxiemeDelai = Math.max(
      1,
      Math.round(Number(String(config.delai_deuxieme_rappel ?? "7").trim()) || 7),
    );

    const { data: brouillons, error: brouillonsErr } = await admin
      .from("brouillons")
      .select("id")
      .eq("concession_id", concessionId);

    if (brouillonsErr) {
      console.error("[actions/send-relances] brouillons read:", brouillonsErr);
      continue;
    }

    const brouillonIds = (brouillons ?? [])
      .map((b) => String((b as { id?: string }).id ?? "").trim())
      .filter(Boolean);
    console.log("brouillonIds:", brouillonIds);

    if (brouillonIds.length === 0) {
      console.log("[actions/send-relances] Aucun brouillon pour concession:", concessionId);
      continue;
    }

    const delaiMs1 = premierDelai * 24 * 60 * 60 * 1000;
    const dateLimit1 = new Date(now.getTime() - delaiMs1).toISOString();

    const idsForIn =
      brouillonIds.length > 0
        ? brouillonIds
        : ["00000000-0000-0000-0000-000000000000"];

    console.log("=== SEND-RELANCES DEBUG ===");
    console.log("concession_id:", body.concession_id);
    console.log("concessionId (boucle):", concessionId);
    console.log("brouillonIds trouvés:", brouillonIds);
    console.log("dateLimit relance1:", dateLimit1);

    const { data: aRelancer1Debug, error: err1 } = await admin
      .from("signature_requests")
      .select("id, created_at, brouillon_id, relance_1_sent_at")
      .in("brouillon_id", idsForIn)
      .is("signed_at", null)
      .is("relance_1_sent_at", null)
      .lte("created_at", dateLimit1);

    console.log("aRelancer1:", aRelancer1Debug);
    console.log("err1:", err1);

    const { data: tousLesSR } = await admin
      .from("signature_requests")
      .select("id, created_at, signed_at, relance_1_sent_at, brouillon_id")
      .in("brouillon_id", idsForIn);

    console.log("TOUS les signature_requests:", tousLesSR);

    console.log("Config relances:", config);
    console.log("Délai jours (relance 1):", premierDelai);
    console.log("Date limite calculée (relance 1):", dateLimit1);
    console.log("Date now:", now.toISOString());
    console.log("brouillonIds:", brouillonIds);

    const { data: poolRelance1, error: r1PoolErr } = await admin
      .from("signature_requests")
      .select(
        "id, token, expires_at, brouillon_id, client_email, client_nom, client_prenom, form_data, created_at, relance_1_sent_at, relance_2_sent_at",
      )
      .in("brouillon_id", brouillonIds)
      .is("signed_at", null)
      .is("relance_1_sent_at", null);

    if (r1PoolErr) {
      console.error("[actions/send-relances] relance1 pool read:", r1PoolErr);
      continue;
    }

    console.log("aRelancer1 avant filtre (sans created_at):", poolRelance1?.length, poolRelance1);

    const aRelancer1 = (poolRelance1 ?? []).filter((row) => {
      const ts = String((row as { created_at?: string | null }).created_at ?? "").trim();
      if (!ts) return false;
      return ts <= dateLimit1;
    });

    console.log("aRelancer1 après filtre created_at:", aRelancer1.length, aRelancer1);

    for (const sr of aRelancer1) {
      if (await sendRelanceMailForRow(sr as RelanceSrRow, config as RelancesConfigForMail, 1))
        sent += 1;
    }

    const delaiMs2 = deuxiemeDelai * 24 * 60 * 60 * 1000;
    const dateLimit2 = new Date(now.getTime() - delaiMs2).toISOString();

    console.log("Délai jours (relance 2):", deuxiemeDelai);
    console.log("Date limite calculée (relance 2):", dateLimit2);

    const { data: poolRelance2, error: r2PoolErr } = await admin
      .from("signature_requests")
      .select(
        "id, token, expires_at, brouillon_id, client_email, client_nom, client_prenom, form_data, created_at, relance_1_sent_at, relance_2_sent_at",
      )
      .in("brouillon_id", brouillonIds)
      .is("signed_at", null)
      .not("relance_1_sent_at", "is", null)
      .is("relance_2_sent_at", null);

    if (r2PoolErr) {
      console.error("[actions/send-relances] relance2 pool read:", r2PoolErr);
      continue;
    }

    const aRelancer2 = (poolRelance2 ?? []).filter((row) => {
      const ts = String((row as { created_at?: string | null }).created_at ?? "").trim();
      if (!ts) return false;
      return ts <= dateLimit2;
    });

    console.log("aRelancer2 après filtre created_at:", aRelancer2.length, aRelancer2);

    for (const sr of aRelancer2) {
      if (await sendRelanceMailForRow(sr as RelanceSrRow, config as RelancesConfigForMail, 2))
        sent += 1;
    }
  }

  return res.status(200).json({ sent });
}

function briefingAlerteEstChiffreAffairesOuCa(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("ca du mois") || m.includes("c.a. du mois")) return true;
  if (m.includes("chiffre") && m.includes("affaires")) return true;
  if (m.includes("ca ") && m.includes("mois") && (m.includes("véhicule") || m.includes("vehicule")))
    return true;
  if (m.includes("ca ") && m.includes("vendu")) return true;
  return false;
}

async function handleGenerateBriefing(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorise" });

  const body = data as GenerateBriefingBody;
  const requestedConcessionId = String(body.concession_id ?? "").trim();
  if (!requestedConcessionId) {
    return res.status(400).json({ error: "concession_id requis" });
  }

  const admin = await getSupabaseAdmin();
  const activeConcessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!activeConcessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }
  const allowedRequestId =
    requestedConcessionId === activeConcessionId || requestedConcessionId === userId;
  if (!allowedRequestId) {
    return res.status(403).json({ error: "Concession invalide." });
  }
  const queryConcessionId = activeConcessionId;

  const openAiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!openAiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY manquante." });
  }

  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const { data: brouillons, error: brouillonsErr } = await admin
      .from("brouillons")
      .select("id")
      .eq("concession_id", queryConcessionId);
    if (brouillonsErr) {
      console.error("[actions/generate-briefing] brouillons:", brouillonsErr);
      return res.status(500).json({ error: "Erreur lecture brouillons." });
    }

    const brouillonIds =
      brouillons?.map((b) => String((b as { id?: string }).id ?? "").trim()).filter(Boolean) ??
      [];

    const { data: bonsEnAttente, error: bonsErr } = await admin
      .from("signature_requests")
      .select("id, created_at, brouillon_id, relance_1_sent_at, relance_2_sent_at")
      .is("signed_at", null)
      .in(
        "brouillon_id",
        brouillonIds.length > 0 ? brouillonIds : ["00000000-0000-0000-0000-000000000000"],
      );
    if (bonsErr) {
      console.error("[actions/generate-briefing] signature_requests:", bonsErr);
      return res.status(500).json({ error: "Erreur lecture bons en attente." });
    }

    console.log("bonsEnAttente:", bonsEnAttente?.length);

    const { data: factures, error: facturesErr } = await admin
      .from("factures")
      .select("prix_ttc, created_at, statut")
      .eq("concession_id", queryConcessionId)
      .gte("created_at", startOfMonth.toISOString())
      .neq("statut", "annulee");
    if (facturesErr) {
      console.error("[actions/generate-briefing] factures:", facturesErr);
      return res.status(500).json({ error: "Erreur lecture factures." });
    }

    const caMois =
      factures?.reduce((sum, facture) => {
        const amount =
          typeof facture.prix_ttc === "number"
            ? facture.prix_ttc
            : Number.parseFloat(String(facture.prix_ttc ?? "0"));
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0) ?? 0;

    const { data: ventesData, error: ventesErr } = await admin
      .from("stock_vehicules")
      .select("id, updated_at")
      .eq("concession_id", queryConcessionId)
      .eq("statut", "vendu")
      .gte("updated_at", startOfMonth.toISOString());
    if (ventesErr) {
      console.error("[actions/generate-briefing] stock vendus:", ventesErr);
      return res.status(500).json({ error: "Erreur lecture ventes." });
    }
    const nbVentes = ventesData?.length ?? 0;

    const { data: stockDort, error: stockErr } = await admin
      .from("stock_vehicules")
      .select("id, donnees, created_at")
      .eq("concession_id", queryConcessionId)
      .eq("disponible", true)
      .lte("created_at", thirtyDaysAgo.toISOString());
    if (stockErr) {
      console.error("[actions/generate-briefing] stock dormant:", stockErr);
      return res.status(500).json({ error: "Erreur lecture stock dormant." });
    }

    const { data: relancesConfig, error: relancesErr } = await admin
      .from("relances_config")
      .select("*")
      .eq("concession_id", queryConcessionId)
      .eq("actif", true)
      .maybeSingle();
    if (relancesErr) {
      console.error("[actions/generate-briefing] relances_config:", relancesErr);
      return res.status(500).json({ error: "Erreur lecture configuration relances." });
    }

    const seuilRelanceJours = Math.max(
      1,
      Number(relancesConfig?.delai_premier_rappel ?? 3) || 3,
    );
    const seuilRelance2Jours = Math.max(
      1,
      Number(relancesConfig?.delai_deuxieme_rappel ?? 7) || 7,
    );
    const listeBons = bonsEnAttente ?? [];

    type SrAttente = {
      created_at?: string | null;
      brouillon_id?: string | null;
      relance_1_sent_at?: string | null;
      relance_2_sent_at?: string | null;
    };

    const brouillonsMap = new Map<string, SrAttente>();
    for (const sr of listeBons) {
      const row = sr as SrAttente;
      const bid = String(row.brouillon_id ?? "").trim();
      if (!bid) continue;
      const existing = brouillonsMap.get(bid);
      const tNew = new Date(String(row.created_at ?? "")).getTime();
      const tOld = existing
        ? new Date(String(existing.created_at ?? "")).getTime()
        : Number.NaN;
      if (
        !existing ||
        (!Number.isNaN(tNew) && (Number.isNaN(tOld) || tNew > tOld))
      ) {
        brouillonsMap.set(bid, row);
      }
    }

    const bonsUniques = Array.from(brouillonsMap.values());
    const nbBonsEnAttente = bonsUniques.length;

    const bonsRecents =
      bonsUniques.filter((b) => {
        const createdAt = new Date(String(b.created_at ?? ""));
        if (Number.isNaN(createdAt.getTime())) return false;
        const jours = Math.floor(
          (today.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        return jours < seuilRelanceJours;
      }).length || 0;

    // Par bon (brouillon) unique : dernière signature_request, délais et relances déjà envoyées
    const bonsARelancer =
      bonsUniques.filter((b) => {
        const createdAt = new Date(String(b.created_at ?? ""));
        if (Number.isNaN(createdAt.getTime())) return false;
        const joursAttente = Math.floor(
          (today.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        const r1 = b.relance_1_sent_at;
        const r2 = b.relance_2_sent_at;
        const relance1Faite = Boolean(r1 && String(r1).trim() !== "");
        const relance2Faite = Boolean(r2 && String(r2).trim() !== "");

        const eligibleRelance1 =
          joursAttente >= seuilRelanceJours && !relance1Faite;
        const eligibleRelance2 =
          joursAttente >= seuilRelance2Jours && relance1Faite && !relance2Faite;

        return eligibleRelance1 || eligibleRelance2;
      }).length || 0;

    const prompt = `
Tu es l'assistant IA d'AutoDocs, un logiciel pour concessions automobiles françaises.

Génère un briefing matinal court, professionnel et motivant pour le commercial. Utilise ces données :

- Bons récents en attente de signature (brouillons distincts, délai depuis la dernière demande de signature : moins de ${seuilRelanceJours} jour(s), pas encore en retard) : ${bonsRecents}
- Bons en retard éligibles à une relance (brouillons distincts, selon la dernière demande et les relances déjà envoyées) : ${bonsARelancer}
- Total bons en attente de signature (brouillons distincts avec au moins une demande non signée) : ${nbBonsEnAttente}
- CA du mois en cours (affiché à part dans l'app, ne pas en faire une alerte) : ${caMois.toLocaleString("fr-FR")}€
- Véhicules vendus ce mois (affiché à part, ne pas en faire une alerte) : ${nbVentes}
- Véhicules en stock depuis +30 jours : ${stockDort?.length ?? 0}
- Date du jour : ${today.toLocaleDateString("fr-FR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}

Format de réponse UNIQUEMENT en JSON :
{
  "salutation": "Bonjour ! Voici votre briefing du [jour]",
  "resume": "Une phrase de résumé de la situation",
  "alertes": [
    {
      "type": "warning|success|info",
      "icone": "🔔|✅|📊|🚗|💰",
      "message": "Message court et actionnable",
      "action": "Texte du bouton d'action ou null"
    }
  ]
}

Maximum 4 alertes. Priorise les urgences.

Si ${nbBonsEnAttente} === 0 et ${bonsARelancer} === 0 et ${stockDort?.length ?? 0} === 0 (aucun bon en attente de signature, aucune relance urgente, aucun véhicule en stock depuis plus de 30 jours), génère EXACTEMENT UNE SEULE alerte de type "success" avec un message encourageant et factuel, icône "✅", action null. Exemples de formulations acceptables :
- "Tout est à jour — aucun bon en attente de relance."
- "Aucune action requise aujourd'hui, bonne journée !"
- "Tous vos bons sont signés — continuez ainsi !"
N'invente pas de problèmes s'il n'y en a pas. Pas de conseils génériques : uniquement un constat positif court.

N'inclus AUCUNE alerte sur le chiffre d'affaires, le CA du mois, les ventes du mois ou le nombre de véhicules vendus : l'interface les affiche déjà dans un encart dédié sous les alertes.

IMPORTANT : ne génère PAS deux alertes pour la même chose (ne mélange pas « bons récents » et « relances urgentes »).
Si ${bonsARelancer} > 0, parle uniquement des relances urgentes pour ce sujet (pas une alerte séparée pour les bons récents).
Si ${bonsARelancer} === 0 et ${bonsRecents} > 0, parle des bons en attente normaux (suivi habituel, sans dramatiser).
Si ${bonsARelancer} === 0 et ${bonsRecents} === 0 et (${nbBonsEnAttente} > 0 ou ${stockDort?.length ?? 0} > 0), au plus une ou deux alertes factuelles (info ou warning) sur ces seuls sujets, sans dramatiser ni inventer d'autres problèmes.

Pour les relances, utilise une formulation directe et professionnelle comme :
'X bon(s) en attente de signature depuis plus de X jours — pensez à relancer vos clients.'
ou
'X client(s) n'ont pas encore signé leur bon de commande.'

Jamais de formulation comme 'pour maintenir le contact' ou trop commerciale/marketing. Ton : direct, factuel, professionnel.

Retourne UNIQUEMENT le JSON, rien d'autre.
`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!openaiRes.ok) {
      const raw = await openaiRes.text().catch(() => "");
      console.error("[actions/generate-briefing] openai:", openaiRes.status, raw);
      return res.status(500).json({ error: "Erreur génération briefing IA." });
    }

    const openaiData = (await openaiRes.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const briefingRaw = String(openaiData.choices?.[0]?.message?.content ?? "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!briefingRaw) {
      return res.status(500).json({ error: "Réponse IA vide." });
    }

    const briefing = JSON.parse(briefingRaw) as {
      salutation?: unknown;
      resume?: unknown;
      alertes?: unknown;
    };

    if (
      typeof briefing.salutation !== "string" ||
      typeof briefing.resume !== "string" ||
      !Array.isArray(briefing.alertes)
    ) {
      return res.status(500).json({ error: "Format briefing invalide." });
    }

    const alertesFiltered = briefing.alertes.filter((item) => {
      if (!item || typeof item !== "object") return true;
      const msg = String((item as { message?: unknown }).message ?? "");
      return !briefingAlerteEstChiffreAffairesOuCa(msg);
    });

    const briefingOut = {
      salutation: briefing.salutation,
      resume: briefing.resume,
      alertes: alertesFiltered,
    };

    return res.status(200).json({
      success: true,
      briefing: briefingOut,
      stats: {
        ca_mois: caMois,
        nb_ventes: nbVentes,
        bons_en_attente: nbBonsEnAttente,
        bons_a_relancer: bonsARelancer,
      },
    });
  } catch (err) {
    console.error("[actions/generate-briefing] exception:", err);
    return res.status(500).json({ error: "Erreur serveur briefing." });
  }
}

/* ==================================================================
 *  CERFA 15776*01 — Remplissage du PDF officiel via pdf-lib
 *
 *  Le PDF de référence (`public/templates/cerfa_15776-01.pdf`) est un
 *  AcroForm 2 pages publié par la République française : Page1 et
 *  Page2 portent les mêmes champs (114 au total). On remplit les deux
 *  pages avec les mêmes valeurs puis `flatten()` pour figer le rendu.
 *
 *  Mapping radios / cases (option PDF "1" = première option, "2" = seconde) :
 *    radio1 = Présence du certificat d'immatriculation : OUI=1 / NON=2
 *    radio2 = Vendeur : Personne physique=1 / morale=2
 *    radio3 = Vendeur : Sexe M=1 / F=2 (pertinent si physique)
 *    radio4 = Vendeur : « céder »=1 / « céder pour destruction »=2
 *    radio5 = Acheteur : Personne physique=1 / morale=2
 *    radio6 = Acheteur : Sexe M=1 / F=2
 *    ckb_ValidationDéclaration1/2/3  = certifications vendeur (3 cases)
 *    ckb_ValidationDéclarationA1/A2  = certifications acheteur (2 cases)
 *
 *  Vercel : le fichier est inclus dans le bundle de la fonction grâce
 *  à `vercel.json` → `functions["api/actions.ts"].includeFiles`.
 * ================================================================== */

type CerfaInput = Record<string, unknown>;

const TYPES_VOIE_RE =
  /^(rue|avenue|av\.?|bd\.?|boulevard|impasse|chemin|route|place|all[ée]e|cours|quai|chauss[ée]e|square|zone|zac|za|villa|passage|sentier|esplanade|hameau|lieu-dit|cit[ée])\b/i;

function pickStr(o: CerfaInput, key: string): string {
  const v = o[key];
  return typeof v === "string" ? v.trim() : "";
}
function pickBool(o: CerfaInput, key: string): boolean {
  const v = o[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * Découpe une adresse libre en (numéro, extension, type de voie, nom).
 * Si le pattern ne matche pas, l'intégralité va dans `nomVoie` — le
 * formulaire reste correct (la voie complète apparaît).
 */
function parseAdresse(raw: string): {
  numero: string;
  extension: string;
  typeVoie: string;
  nomVoie: string;
} {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return { numero: "", extension: "", typeVoie: "", nomVoie: "" };
  const m = /^(\d+)\s*(?:(bis|ter|quater)\s+)?(.+)$/i.exec(trimmed);
  if (!m) return { numero: "", extension: "", typeVoie: "", nomVoie: trimmed };
  const numero = m[1];
  const extension = (m[2] ?? "").toLowerCase();
  const reste = m[3];
  const typeMatch = TYPES_VOIE_RE.exec(reste);
  if (!typeMatch) {
    return { numero, extension, typeVoie: "", nomVoie: reste };
  }
  const typeVoie = typeMatch[1];
  const nomVoie = reste.slice(typeMatch[0].length).trim();
  return { numero, extension, typeVoie, nomVoie };
}

/**
 * Découpe une date "DD/MM/YYYY" (ou "YYYY-MM-DD") en (jour, mois, année).
 */
function parseDate(raw: string): { j: string; m: string; a: string } {
  const s = raw.trim();
  if (!s) return { j: "", m: "", a: "" };
  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (slash) {
    const j = slash[1].padStart(2, "0");
    const m = slash[2].padStart(2, "0");
    const aRaw = slash[3];
    const a = aRaw.length === 2 ? `20${aRaw}` : aRaw;
    return { j, m, a };
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    return {
      j: iso[3].padStart(2, "0"),
      m: iso[2].padStart(2, "0"),
      a: iso[1],
    };
  }
  return { j: "", m: "", a: "" };
}

/**
 * Découpe une heure (H, HH, "HH:MM", "HHhMM") en (HH, MM).
 */
function parseHeure(raw: string): { hh: string; mm: string } {
  const s = raw.trim();
  if (!s) return { hh: "", mm: "" };
  const both = /^(\d{1,2})[h:.](\d{1,2})$/i.exec(s);
  if (both) {
    return { hh: both[1].padStart(2, "0"), mm: both[2].padStart(2, "0") };
  }
  const justH = /^(\d{1,2})$/.exec(s);
  if (justH) return { hh: justH[1].padStart(2, "0"), mm: "00" };
  return { hh: "", mm: "" };
}

function loadCerfaTemplate(): Buffer {
  // Le bundle Vercel inclut public/templates/** via vercel.json.
  const filePath = path.join(
    process.cwd(),
    "public",
    "templates",
    "cerfa_15776-01.pdf",
  );
  return readFileSync(filePath);
}

async function handleFillCerfa(
  req: VercelRequest,
  data: CerfaInput,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const cerfaInput =
    data.cerfa_data && typeof data.cerfa_data === "object"
      ? (data.cerfa_data as CerfaInput)
      : (data as CerfaInput);

  // ---------- Données véhicule ----------
  const immat = pickStr(cerfaInput, "immatriculation");
  const vin = pickStr(cerfaInput, "vin");
  const dateMec = parseDate(pickStr(cerfaInput, "date_mise_en_circulation"));
  const marque = pickStr(cerfaInput, "marque");
  const typeVariante = pickStr(cerfaInput, "type_variante");
  const denomination = pickStr(cerfaInput, "denomination");
  const kilometrage = pickStr(cerfaInput, "kilometrage");
  const numeroFormule = pickStr(cerfaInput, "numero_formule");
  const dateCi = parseDate(pickStr(cerfaInput, "date_ci_ancien_format"));
  const motifAbsenceCi = pickStr(cerfaInput, "motif_absence_ci");

  // ---------- Vendeur (ancien propriétaire) = toujours personne morale (concession) ----------
  /** Jamais physique / M. / Mme côté vendeur sur ce flux (évite tout défaut « féminin » du PDF). */
  const vendeurNom = pickStr(cerfaInput, "vendeur_nom");
  const vendeurSiren = pickStr(cerfaInput, "vendeur_siren").replace(/\s+/g, "");
  const vendeurAdresse = parseAdresse(pickStr(cerfaInput, "vendeur_adresse"));
  const vendeurCp = pickStr(cerfaInput, "vendeur_code_postal");
  const vendeurVille = pickStr(cerfaInput, "vendeur_ville");
  const cessionDate = parseDate(pickStr(cerfaInput, "cession_date"));
  const cessionHeure = parseHeure(pickStr(cerfaInput, "cession_heure"));
  const cessionLieu = pickStr(cerfaInput, "cession_lieu");
  /** Toujours cochées (certifications vendeur obligatoires CERFA). */
  const certifSituation = true;
  const certifNonTransfo = true;
  const certifVhu = pickBool(cerfaInput, "certif_vhu");
  const vendeurAgrement = pickStr(cerfaInput, "vendeur_agrement_vhu");
  const cession = pickStr(cerfaInput, "cession_motif").toLowerCase(); // "" | "destruction"

  // ---------- Acheteur ----------
  const acheteurType =
    pickStr(cerfaInput, "acheteur_type").toLowerCase() === "morale"
      ? "morale"
      : "physique";
  const acheteurSexe = pickStr(cerfaInput, "acheteur_sexe").toUpperCase(); // "M" | "F"
  const acheteurNom = pickStr(cerfaInput, "acheteur_nom");
  const acheteurPrenom = pickStr(cerfaInput, "acheteur_prenom");
  const acheteurSiret =
    pickStr(cerfaInput, "acheteur_siret").replace(/\s+/g, "");
  const acheteurDateNaiss = parseDate(
    pickStr(cerfaInput, "acheteur_date_naissance"),
  );
  const acheteurLieuNaiss = pickStr(cerfaInput, "acheteur_lieu_naissance");
  const acheteurAdresse = parseAdresse(pickStr(cerfaInput, "acheteur_adresse"));
  const acheteurCp = pickStr(cerfaInput, "acheteur_code_postal");
  const acheteurVille = pickStr(cerfaInput, "acheteur_ville");

  // Validation minimale
  if (!immat || !acheteurNom || !acheteurAdresse.nomVoie) {
    return res.status(400).json({
      error:
        "Champs requis manquants : immatriculation, nom acheteur, adresse acheteur.",
    });
  }

  // ---------- Chargement du PDF officiel ----------
  let pdfBytes: Buffer;
  try {
    pdfBytes = loadCerfaTemplate();
  } catch (err) {
    console.error("[fill-cerfa] template not found:", err);
    return res.status(500).json({
      error:
        "Modèle CERFA introuvable côté serveur (public/templates/cerfa_15776-01.pdf).",
    });
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes);
  } catch (err) {
    console.error("[fill-cerfa] PDFDocument.load:", err);
    return res.status(500).json({ error: "PDF officiel illisible." });
  }
  const form = doc.getForm();

  // Helpers tolérants : maxLength, champ inconnu, etc.
  const safeSetText = (name: string, value: string) => {
    try {
      const f = form.getTextField(name);
      const max = f.getMaxLength();
      const v = max !== undefined ? value.slice(0, max) : value;
      f.setText(v);
    } catch (err) {
      console.warn("[fill-cerfa] setText", name, err);
    }
  };
  const safeCheck = (name: string, on: boolean) => {
    try {
      const f = form.getCheckBox(name);
      if (on) f.check();
      else f.uncheck();
    } catch (err) {
      console.warn("[fill-cerfa] check", name, err);
    }
  };
  const safeRadio = (name: string, option: string | null) => {
    if (!option) return;
    try {
      form.getRadioGroup(name).select(option);
    } catch (err) {
      console.warn("[fill-cerfa] radio", name, err);
    }
  };

  // On remplit les deux pages identiquement.
  const PAGES = ["Page1", "Page2"] as const;

  for (const PG of PAGES) {
    const p = `topmostSubform[0].${PG}[0]`;

    // ---- Véhicule ----
    safeSetText(`${p}.num_Immatriculation[0]`, immat);
    safeSetText(`${p}.num_Identification[0]`, vin);
    safeSetText(`${p}.num_DateImmatriculationJour[0]`, dateMec.j);
    safeSetText(`${p}.num_DateImmatriculationMois[0]`, dateMec.m);
    safeSetText(`${p}.num_DateImmatriculationAnnée[0]`, dateMec.a);
    safeSetText(`${p}.txt_MarqueVéhicule[0]`, marque);
    safeSetText(`${p}.txt_TypeVarianteVersionVéhicule[0]`, typeVariante);
    /* J.1 — toujours véhicule particulier (code VP, aligné avec l’UI CERFA.tsx). */
    safeSetText(`${p}.txt_GenreNational[0]`, "VP");
    safeSetText(`${p}.txt_DénominationCommerciale[0]`, denomination);
    safeSetText(`${p}.num_KilométrageCompteur[0]`, kilometrage);

    // Présence du certificat d'immatriculation : OUI si numero_formule fourni.
    const certificatPresent = numeroFormule.length > 0;
    safeRadio(`${p}.Groupe_de_boutons_radio1[0]`, certificatPresent ? "1" : "2");
    safeSetText(`${p}.num_Formule[0]`, numeroFormule);
    safeSetText(`${p}.txt_MotifAbscenceCertificat[0]`, motifAbsenceCi);
    safeSetText(`${p}.num_DateCertificatJour[0]`, dateCi.j);
    safeSetText(`${p}.num_DateCertificatMois[0]`, dateCi.m);
    safeSetText(`${p}.num_DateCertificatAnnée[0]`, dateCi.a);

    // ---- Vendeur : personne morale uniquement ; décocher tout sexe M/F (template peut laisser Mme par défaut)
    safeRadio(`${p}.Groupe_de_boutons_radio2[0]`, "2");
    try {
      form.getRadioGroup(`${p}.Groupe_de_boutons_radio3[0]`).clear();
    } catch (err) {
      console.warn("[fill-cerfa] vendeur sexe (radio3) clear", err);
    }
    safeSetText(`${p}.txt_IdentitéVendeur[0]`, vendeurNom);
    safeSetText(`${p}.Num_Siret[0]`, vendeurSiren);
    safeSetText(`${p}.num_VoieAdresse[0]`, vendeurAdresse.numero);
    safeSetText(`${p}.txt_ExtensionAdresse[0]`, vendeurAdresse.extension);
    safeSetText(`${p}.txt_TypeVoieAdresse[0]`, vendeurAdresse.typeVoie);
    safeSetText(`${p}.txt_NomVoie[0]`, vendeurAdresse.nomVoie);
    safeSetText(`${p}.num_CodePostalAdresse[0]`, vendeurCp);
    safeSetText(`${p}.txt_CommuneAdresse[0]`, vendeurVille);

    // « céder » vs « céder pour destruction »
    safeRadio(
      `${p}.Groupe_de_boutons_radio4[0]`,
      cession === "destruction" ? "2" : "1",
    );
    safeSetText(`${p}.num_DateVenteJour[0]`, cessionDate.j);
    safeSetText(`${p}.num_DateVenteMois[0]`, cessionDate.m);
    safeSetText(`${p}.num_DateVenteAnnée[0]`, cessionDate.a);
    safeSetText(`${p}.num_HoraireVente1[0]`, cessionHeure.hh);
    safeSetText(`${p}.num_HoraireVente2[0]`, cessionHeure.mm);
    safeSetText(`${p}.num_Agrément[0]`, vendeurAgrement);
    safeSetText(`${p}.txt_LieuDéclaration1[0]`, cessionLieu);
    safeSetText(`${p}.num_DateDéclaration[0]`, pickStr(cerfaInput, "cession_date"));

    // 3 certifications vendeur
    safeCheck(`${p}.ckb_ValidationDéclaration1[0]`, certifSituation);
    safeCheck(`${p}.ckb_ValidationDéclaration2[0]`, certifNonTransfo);
    safeCheck(`${p}.ckb_ValidationDéclaration3[0]`, certifVhu);

    // ---- Acheteur ----
    safeRadio(
      `${p}.Groupe_de_boutons_radio5[0]`,
      acheteurType === "morale" ? "2" : "1",
    );
    if (acheteurType === "physique") {
      safeRadio(
        `${p}.Groupe_de_boutons_radio6[0]`,
        acheteurSexe === "M" ? "1" : acheteurSexe === "F" ? "2" : null,
      );
    }
    const acheteurFullName =
      [acheteurNom, acheteurPrenom].filter(Boolean).join(" ").trim();
    safeSetText(`${p}.txt_IdentitéAcheteur[0]`, acheteurFullName);
    safeSetText(`${p}.num_SiretAcheteur[0]`, acheteurSiret);
    safeSetText(
      `${p}.txt_LieuNaissanceAcheteur[0]`,
      acheteurLieuNaiss,
    );
    safeSetText(`${p}.num_DateNaissanceAcheteurJ[0]`, acheteurDateNaiss.j);
    safeSetText(`${p}.num_DateNaissanceAcheteurM[0]`, acheteurDateNaiss.m);
    safeSetText(`${p}.num_DateNaissanceAcheteurA[0]`, acheteurDateNaiss.a);
    safeSetText(`${p}.num_VoieAdresseAcheteur[0]`, acheteurAdresse.numero);
    safeSetText(
      `${p}.txt_ExtensionAdresseAcheteur[0]`,
      acheteurAdresse.extension,
    );
    safeSetText(
      `${p}.txt_TypeVoieAdresseAcheteur[0]`,
      acheteurAdresse.typeVoie,
    );
    safeSetText(`${p}.txt_NomVoieAdresseAcheteur[0]`, acheteurAdresse.nomVoie);
    safeSetText(`${p}.num_CodePostalAdresseAcheteur[0]`, acheteurCp);
    safeSetText(`${p}.txt_CommuneAdresseAcheteur[0]`, acheteurVille);
    safeSetText(`${p}.txt_LieuDéclaration2[0]`, cessionLieu);
    safeSetText(`${p}.txt_dateDéclaration[0]`, pickStr(cerfaInput, "cession_date"));

    // 2 certifications acheteur — cochées par défaut (l'acheteur « acquiert »
    // et « est informé »), peuvent être explicitement décochées via input.
    const certAcquerir = cerfaInput.acheteur_cert_acquerir === false ? false : true;
    const certInforme = cerfaInput.acheteur_cert_informe === false ? false : true;
    safeCheck(`${p}.ckb_ValidationDéclarationA1[0]`, certAcquerir);
    safeCheck(`${p}.ckb_ValidationDéclarationA2[0]`, certInforme);

    // Opposition à la prospection commerciale (par défaut non cochée)
    safeCheck(
      `${p}.ckb_OppositionUtilisationDonnée[0]`,
      pickBool(cerfaInput, "opposition_prospection"),
    );
  }

  // Fige les valeurs pour qu'elles s'affichent partout (impressions, viewers
  // mobiles, etc.). flatten() supprime aussi tout reste de XFA.
  try {
    form.flatten();
  } catch (err) {
    console.warn("[fill-cerfa] flatten:", err);
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await doc.save();
  } catch (err) {
    console.error("[fill-cerfa] save:", err);
    return res.status(500).json({ error: "Échec de la génération du PDF." });
  }

  return res.status(200).json({
    pdf_base64: Buffer.from(outBytes).toString("base64"),
  });
}

async function handleGenerateFacture(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  console.log("generate-facture body reçu:", data);

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorise" });

  const brouillonId = String(data.brouillon_id ?? "").trim();
  if (!brouillonId) return res.status(400).json({ error: "brouillon_id requis" });

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  const clientConcessionId = data.concession_id != null ? String(data.concession_id).trim() : "";
  if (clientConcessionId && clientConcessionId !== concessionId) {
    console.warn(
      "[generate-facture] concession_id client ≠ serveur:",
      clientConcessionId,
      "vs",
      concessionId,
    );
  }
  console.log("[generate-facture] userId:", userId, "concessionId (serveur):", concessionId);

  const { data: existingDup } = await admin
    .from("factures")
    .select("id, numero_facture, pdf_base64")
    .eq("concession_id", concessionId)
    .eq("brouillon_id", brouillonId)
    .maybeSingle();

  if (existingDup) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      factureId: existingDup.id,
      numero_facture: existingDup.numero_facture,
      pdfBase64: existingDup.pdf_base64 ?? "",
    });
  }

  const { data: row, error: brErr } = await admin
    .from("brouillons")
    .select("*")
    .eq("id", brouillonId)
    .eq("concession_id", concessionId)
    .maybeSingle();

  if (brErr) {
    console.error("[generate-facture] brouillon:", brErr);
    return res.status(500).json({ error: "Erreur lecture brouillon" });
  }
  if (!row || typeof row !== "object") {
    return res.status(404).json({ error: "Brouillon introuvable" });
  }

  const br = row as Record<string, unknown>;
  const kvRaw =
    br.vehicle_field_values && typeof br.vehicle_field_values === "object"
      ? (br.vehicle_field_values as Record<string, unknown>)
      : {};
  const kvStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(kvRaw)) kvStr[k] = String(v ?? "");

  const clientAdresseInput = String(data.client_adresse ?? "").trim();
  const clientEmailInput = String(data.client_email ?? "").trim();
  const clientTelephoneInput = String(data.client_telephone ?? "").trim();

  const stockDonnees = parseStringDict(kvRaw.stock_donnees);
  const prixTtcInput = round2(parseNum(String(br.vehicule_prix ?? data.prix_ttc ?? "0")));
  const tvaTaux = 20;
  const prestations: { libelle: string; prix_ht: number }[] = [];
  const sumPrestHt = round2(prestations.reduce((s, pr) => s + pr.prix_ht, 0));
  const prixHtVehicule = round2(prixTtcInput / 1.2);
  const prixHtTotal = round2(prixHtVehicule + sumPrestHt);
  const prixTtcTotal = round2(prixTtcInput);
  const tvaMontant = round2(prixTtcTotal - prixHtTotal);
  const acompte = round2(parseNum(String(data.acompte ?? br.acompte ?? "0")));
  const repriseMontantFacture = round2(
    parseNum(String(data.reprise_montant ?? kvStr.reprise_valeur ?? "0")),
  );
  const netAPayerTtc = round2(
    Math.max(0, prixTtcTotal - acompte - repriseMontantFacture),
  );

  const mentionGarantie =
    "Le véhicule est vendu dans l'état où il se trouve au jour de la livraison (vente « en l'état »), sans garantie commerciale complémentaire sauf disposition conventionnelle écrite jointe.";

  const kmNonGaranti = false;

  const notes = String(data.notes ?? "").trim();

  const { data: profil } = await admin
    .from("profil_concession")
    .select("*")
    .eq("concession_id", concessionId)
    .maybeSingle();

  const prof = profil as Record<string, unknown> | null;

  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const authEmail = String(authUser?.user?.email ?? "").trim();

  const concessionNom = String(prof?.nom_concession ?? "").trim() || "Concession";
  const concessionAdresse = [
    String(prof?.adresse ?? "").trim(),
    [String(prof?.code_postal ?? "").trim(), String(prof?.ville ?? "").trim()]
      .filter(Boolean)
      .join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const concessionSiret = String(prof?.siret ?? prof?.siren ?? "").trim();
  const concessionTel = String(prof?.telephone ?? "").trim();
  const concessionEmail = String(prof?.email_contact ?? authEmail ?? "").trim();
  const concessionTva = String(prof?.tva_intracommunautaire ?? "").trim();

  let clientTel =
    clientTelephoneInput ||
    String(kvStr.client_telephone ?? "").trim();
  let clientEmailDb =
    clientEmailInput || String(kvStr.client_email ?? "").trim();
  let clientAdresseDb =
    clientAdresseInput ||
    String(br.client_adresse ?? "").trim();
  const clientIdRow =
    br.client_id === null || br.client_id === undefined
      ? null
      : String(br.client_id);

  if (clientIdRow) {
    const { data: cl } = await admin
      .from("clients")
      .select("telephone, email, adresse")
      .eq("id", clientIdRow)
      .eq("concession_id", concessionId)
      .maybeSingle();
    if (cl && typeof cl === "object") {
      const cli = cl as Record<string, unknown>;
      if (!clientTel) clientTel = String(cli.telephone ?? "").trim();
      if (!clientEmailDb) clientEmailDb = String(cli.email ?? "").trim();
      if (!clientAdresseDb) clientAdresseDb = String(cli.adresse ?? "").trim();
    }
  }

  const vehMarque = pickStockField(stockDonnees, ["marque", "brand"]);
  const vehModele = pickStockField(stockDonnees, ["modele", "modèle", "model"]);
  const vehVersion = pickStockField(stockDonnees, ["version", "finition"]);
  const vehType = pickStockField(stockDonnees, ["type", "genre", "carrosserie"]);
  const vehPremCirc = extractPremiereMiseEnCirculation(stockDonnees);
  const vehKm = extractVehiculeField(stockDonnees, [
    "km",
    "kilometrage",
    "kilométrage",
    "kms",
    "kilometre",
    "kilomètres",
    "nb_km",
    "compteur",
  ]);
  const vehVin = extractVehiculeField(stockDonnees, [
    "vin",
    "VIN",
    "numero_serie",
    "numéro de série",
    "n_serie",
    "serie",
    "chassis",
    "châssis",
    "n_chassis",
  ]);
  const vehImmat = extractVehiculeField(stockDonnees, [
    "immat",
    "immatriculation",
    "plaque",
    "numero_immat",
    "n_immat",
    "plaque_immat",
  ]);
  const vehCouleur = extractVehiculeField(stockDonnees, [
    "couleur",
    "color",
    "teinte",
    "coloris",
  ]);
  const vehEnergie = extractVehiculeField(stockDonnees, [
    "energie",
    "énergie",
    "carburant",
    "motorisation",
    "type_energie",
    "fuel",
    "combustible",
  ]);

  const repriseDesc =
    String(data.reprise_vehicule_description ?? "").trim() ||
    [
      [kvStr.reprise_marque, kvStr.reprise_modele].filter(Boolean).join(" "),
      kvStr.reprise_plaque ? `Plaque ${kvStr.reprise_plaque}` : "",
    ]
      .filter(Boolean)
      .join(" — ");

  const today = new Date();
  const dateFactureIso = today.toISOString().slice(0, 10);

  const year = today.getFullYear();
  const timestamp = Date.now().toString().slice(-4);
  const numeroFacture = `FAC-${year}-${timestamp}`;

  const templatePayload: FactureTemplatePayload = {
    numero_facture: numeroFacture,
    date_facture_label: isoDateToFr(dateFactureIso),
    concession_nom: concessionNom,
    concession_siret: concessionSiret || "—",
    concession_adresse: concessionAdresse || "—",
    concession_telephone: concessionTel || "—",
    concession_email: concessionEmail || "—",
    concession_tva_intra: concessionTva || "—",
    client_nom: String(br.client_nom ?? "").trim() || "—",
    client_prenom: String(br.client_prenom ?? "").trim() || "—",
    client_adresse: clientAdresseDb || "—",
    client_email: clientEmailDb || "—",
    client_telephone: clientTel || "—",
    vehicule_marque: vehMarque || "—",
    vehicule_modele: vehModele || "—",
    vehicule_version: vehVersion || "—",
    vehicule_type: vehType || "—",
    vehicule_premiere_circulation: vehPremCirc || "—",
    vehicule_kilometrage: vehKm || "—",
    vehicule_km_non_garanti: kmNonGaranti,
    vehicule_vin: vehVin || "—",
    vehicule_immatriculation: vehImmat || "—",
    vehicule_couleur: vehCouleur || "—",
    vehicule_energie: vehEnergie || "—",
    vehicule_donnees: stockDonnees,
    prestations,
    prix_ht_vehicule_label: formatMoney(prixHtVehicule),
    prix_ht_prestations_label: formatMoney(sumPrestHt),
    prix_ht_total_label: formatMoney(prixHtTotal),
    tva_taux_label: formatMoney(tvaTaux),
    tva_montant_label: formatMoney(tvaMontant),
    prix_ttc_label: formatMoney(prixTtcTotal),
    acompte_label: formatMoney(acompte),
    reprise_montant_label: formatMoney(repriseMontantFacture),
    reprise_description: repriseDesc,
    reste_a_payer_label: formatMoney(netAPayerTtc),
    mention_garantie_vente: mentionGarantie,
    notes,
  };

  let html: string;
  try {
    html = buildFactureHtml(templatePayload);
  } catch (err) {
    console.error("[generate-facture] template:", err);
    return res.status(500).json({ error: "Erreur template facture" });
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPdfFromHtml(html);
  } catch (err) {
    console.error("[generate-facture] pdf:", err);
    return res.status(500).json({ error: "Erreur generation PDF" });
  }

  const pdfBase64 = pdfBuffer.toString("base64");

  const insertRow = {
    concession_id: concessionId,
    created_by: userId,
    brouillon_id: brouillonId,
    client_id: clientIdRow,
    numero_facture: numeroFacture,
    date_facture: dateFactureIso,
    date_livraison: null,
    concession_nom: concessionNom,
    concession_siret: concessionSiret || null,
    concession_adresse: concessionAdresse || null,
    concession_telephone: concessionTel || null,
    concession_email: concessionEmail || null,
    concession_tva_intracommunautaire: concessionTva || null,
    client_nom: String(br.client_nom ?? ""),
    client_prenom: String(br.client_prenom ?? ""),
    client_adresse: clientAdresseDb || null,
    client_email: clientEmailDb || null,
    client_telephone: clientTel || null,
    vehicule_marque: vehMarque || null,
    vehicule_modele: vehModele || null,
    vehicule_version: vehVersion || null,
    vehicule_annee: vehPremCirc || null,
    vehicule_kilometrage: kmNonGaranti ? "Non garanti" : vehKm || null,
    vehicule_vin: vehVin || null,
    vehicule_immatriculation: vehImmat || null,
    vehicule_couleur: vehCouleur || null,
    vehicule_energie: vehEnergie || null,
    prix_ht: prixHtVehicule,
    tva_taux: tvaTaux,
    tva_montant: tvaMontant,
    prix_ttc: prixTtcTotal,
    acompte,
    reste_a_payer: netAPayerTtc,
    reprise_vehicule_description: repriseDesc || null,
    reprise_montant: repriseMontantFacture,
    prestations_supplementaires: prestations,
    statut: "emise",
    notes: notes || null,
    pdf_base64: pdfBase64,
  };

  const { data: inserted, error: insErr } = await admin
    .from("factures")
    .insert(insertRow)
    .select("id")
    .single();

  console.log("Facture insérée:", inserted);
  console.log("Erreur insert:", insErr);

  if (insErr) {
    console.error("[generate-facture] insert:", insErr);
    return res.status(500).json({
      error: insErr.message || "Erreur enregistrement facture",
      details: {
        message: insErr.message,
        code: insErr.code,
        details: insErr.details,
        hint: insErr.hint,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    duplicate: false,
    factureId: inserted?.id,
    numero_facture: numeroFacture,
    pdfBase64: pdfBase64,
  });
}

type SendFactureEmailBody = {
  facture_id?: string;
  client_email?: string;
  client_nom?: string;
  client_prenom?: string;
  pdf_base64?: string;
  numero_facture?: string;
};

/**
 * Envoie la facture PDF par email au client et trace l'envoi côté Supabase.
 *
 * Sécurité : la facture est rechargée via supabaseAdmin en filtrant sur
 * la concession active de l'utilisateur authentifié — un commercial ne
 * peut donc pas envoyer la facture d'une autre concession même en
 * forgeant `facture_id` côté client.
 *
 * Tolérant : `pdf_base64`, `client_email`, `client_nom`, `client_prenom`
 * et `numero_facture` peuvent être omis dans le body — le handler
 * complète automatiquement à partir de la ligne `factures` chargée.
 */
async function handleSendFactureEmail(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const body = data as SendFactureEmailBody;
  const factureId = String(body.facture_id ?? "").trim();
  if (!factureId) return res.status(400).json({ error: "facture_id requis" });

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  // Recharge la facture pour vérifier l'appartenance à la concession et
  // compléter les champs manquants côté serveur.
  const { data: factureRow, error: factureErr } = await admin
    .from("factures")
    .select(
      "id, concession_id, client_email, client_nom, client_prenom, numero_facture, pdf_base64",
    )
    .eq("id", factureId)
    .eq("concession_id", concessionId)
    .maybeSingle();

  if (factureErr) {
    console.error("[actions/send-facture-email] read:", factureErr);
    return res.status(500).json({ error: "Erreur de lecture facture." });
  }
  if (!factureRow) {
    return res.status(404).json({ error: "Facture introuvable." });
  }

  const facture = factureRow as Record<string, unknown>;
  const clientEmail =
    (String(body.client_email ?? "").trim() ||
      String(facture.client_email ?? "").trim());
  const clientNom =
    (String(body.client_nom ?? "").trim() ||
      String(facture.client_nom ?? "").trim());
  const clientPrenom =
    (String(body.client_prenom ?? "").trim() ||
      String(facture.client_prenom ?? "").trim());
  const numeroFacture =
    (String(body.numero_facture ?? "").trim() ||
      String(facture.numero_facture ?? "").trim());
  const pdfBase64 =
    (String(body.pdf_base64 ?? "").trim() ||
      String(facture.pdf_base64 ?? "").trim());

  if (!clientEmail) {
    return res.status(400).json({ error: "Email client manquant" });
  }
  if (!isValidEmail(clientEmail)) {
    return res.status(400).json({ error: "Email client invalide" });
  }
  if (!pdfBase64) {
    return res.status(400).json({ error: "PDF facture indisponible" });
  }

  const resend = new Resend(apiKey);
  const safeNum = numeroFacture || "facture";

  try {
    const { error: mailErr } = await resend.emails.send({
      from: "AutoDocs <noreply@autodocs.services>",
      to: clientEmail,
      subject: `Votre facture ${safeNum} — AutoDocs`,
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e; line-height: 1.55; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e8f; margin-bottom: 16px;">Votre facture</h2>
          <p>Bonjour ${escapeHtml(clientPrenom)} ${escapeHtml(clientNom)},</p>
          <p>Veuillez trouver ci-joint votre facture
            <strong>${escapeHtml(safeNum)}</strong>.</p>
          <p>Merci pour votre confiance.</p>
          <p>Cordialement,<br/>L'équipe AutoDocs</p>
        </div>
      `,
      attachments: [
        {
          filename: `facture-${safeNum}.pdf`,
          content: pdfBase64,
        },
      ],
    });

    if (mailErr) {
      console.error("[actions/send-facture-email] resend:", mailErr);
      return res
        .status(500)
        .json({ error: mailErr.message || "Échec d'envoi email" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec d'envoi email";
    console.error("[actions/send-facture-email] exception:", err);
    return res.status(500).json({ error: message });
  }

  const sentAt = new Date().toISOString();
  const { error: updErr } = await admin
    .from("factures")
    .update({ email_envoye_at: sentAt })
    .eq("id", factureId)
    .eq("concession_id", concessionId);

  if (updErr) {
    // L'email est parti : on logue mais on ne fait pas échouer la requête.
    console.warn("[actions/send-facture-email] update email_envoye_at:", updErr);
  }

  return res.status(200).json({
    ok: true,
    success: true,
    email_envoye_at: sentAt,
  });
}

async function handleLookupInvitation(
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const token = String(data.token ?? "").trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: "Token requis." });
  }
  try {
    const admin = await getSupabaseAdmin();
    const { data: inv, error } = await admin
      .from("invitations")
      .select("id, email, role, expires_at, accepted_at, concession_id, concessions ( nom )")
      .eq("token", token)
      .maybeSingle();
    if (error || !inv) {
      return res.status(404).json({ ok: false, error: "Invitation introuvable." });
    }
    const row = inv as Record<string, unknown>;
    const concession_nom =
      row.concessions && typeof row.concessions === "object"
        ? String((row.concessions as { nom?: string }).nom ?? "").trim() || null
        : null;
    const base = {
      ok: true as const,
      email: String(row.email ?? ""),
      role: row.role === "admin" ? ("admin" as const) : ("commercial" as const),
      concession_id: String(row.concession_id ?? ""),
      concession_nom,
    };
    if (row.accepted_at) {
      return res.status(200).json({
        ...base,
        status: "accepted" as const,
        has_account: true,
      });
    }
    const exp = row.expires_at ? new Date(String(row.expires_at)) : null;
    if (exp && exp.getTime() < Date.now()) {
      return res.status(200).json({
        ...base,
        status: "expired" as const,
        has_account: false,
      });
    }
    const email = String(row.email ?? "");
    const has_account = await authUserExistsByEmail(admin, email);
    return res.status(200).json({
      ...base,
      status: "pending" as const,
      has_account,
    });
  } catch (err) {
    console.error("[actions/lookup-invitation]", err);
    return res.status(500).json({ ok: false, error: "Erreur serveur." });
  }
}

async function handleInviteMembre(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const emailRaw = String(data.email ?? "").trim().toLowerCase();
  if (!emailRaw || !isValidEmail(emailRaw)) {
    return res.status(400).json({ error: "Email invalide." });
  }

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId || !(await assertIsAdminOfConcession(admin, userId, concessionId))) {
    return res.status(403).json({ error: "Seul l'admin peut inviter des membres." });
  }

  const { data: authSelf } = await admin.auth.admin.getUserById(userId);
  const selfEmail = authSelf?.user?.email?.trim().toLowerCase() ?? "";
  if (emailRaw === selfEmail) {
    return res.status(400).json({ error: "Vous ne pouvez pas vous inviter vous-même." });
  }

  const { data: membres } = await admin
    .from("membres_concession")
    .select("email")
    .eq("concession_id", concessionId)
    .eq("actif", true);

  const emailTaken = (membres ?? []).some(
    (m) => String((m as { email?: string }).email ?? "").trim().toLowerCase() === emailRaw,
  );
  if (emailTaken) {
    return res.status(409).json({ error: "Ce collaborateur fait déjà partie de l'équipe." });
  }

  await admin
    .from("invitations")
    .delete()
    .eq("concession_id", concessionId)
    .eq("email", emailRaw)
    .is("accepted_at", null);

  const roleRaw = String(data.role ?? "commercial").trim();
  const role = roleRaw === "admin" ? "admin" : "commercial";

  const { data: inserted, error: insErr } = await admin
    .from("invitations")
    .insert({
      concession_id: concessionId,
      email: emailRaw,
      role,
      created_by: userId,
    })
    .select("token")
    .single();

  if (insErr || !inserted?.token) {
    console.error("[invite-membre] insert", insErr);
    return res.status(500).json({ error: insErr?.message ?? "Impossible de créer l'invitation." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const { data: concRow } = await admin
    .from("concessions")
    .select("nom")
    .eq("id", concessionId)
    .maybeSingle();
  const nomConcession =
    String((concRow as { nom?: string } | null)?.nom ?? "").trim() || "AutoDocs";

  const appUrl = getPublicAppUrl(req);
  const inviteUrl = `${appUrl}/invitation/${inserted.token}`;

  const resend = new Resend(apiKey);
  const from = "AutoDocs <noreply@autodocs.services>";
  const subject = `Vous êtes invité à rejoindre ${nomConcession} sur AutoDocs`;
  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1a1a2e;">
      <p>Bonjour,</p>
      <p>Vous avez été invité à rejoindre l'espace <strong>${escapeHtml(nomConcession)}</strong> sur AutoDocs.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;background:#2c3e8f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Accepter l'invitation</a></p>
      <p style="font-size:12px;color:#666;">Ce lien est valable 7 jours :<br><a href="${inviteUrl}">${inviteUrl}</a></p>
    </div>
  `;

  const { error: mailErr } = await resend.emails.send({
    from,
    to: emailRaw,
    subject,
    html,
  });
  if (mailErr) {
    console.error("[invite-membre] resend", mailErr);
    return res
      .status(500)
      .json({ error: "Invitation créée mais l'email n'a pas pu être envoyé." });
  }

  return res.status(200).json({ ok: true });
}

async function handleAcceptInvitation(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const token = String(data.token ?? "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "Token requis." });

  const password = typeof data.password === "string" ? data.password : "";
  const prenom = String(data.prenom ?? "").trim();
  const nom = String(data.nom ?? "").trim();

  const admin = await getSupabaseAdmin();
  const { data: inv, error: invErr } = await admin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (invErr || !inv) {
    return res.status(404).json({ ok: false, error: "Invitation introuvable." });
  }

  const invitation = inv as Record<string, unknown>;
  if (invitation.accepted_at) {
    return res.status(409).json({ ok: false, error: "Invitation déjà acceptée." });
  }
  const exp = invitation.expires_at ? new Date(String(invitation.expires_at)) : null;
  if (exp && exp.getTime() < Date.now()) {
    return res.status(410).json({ ok: false, error: "Invitation expirée." });
  }

  const invitationEmail = String(invitation.email ?? "").trim().toLowerCase();
  const concessionTarget = String(invitation.concession_id ?? "").trim();
  const inviteRole = invitation.role === "admin" ? "admin" : "commercial";

  let targetUserId: string | null = null;

  if (password.length >= 6) {
    if (!prenom || !nom) {
      return res.status(400).json({ ok: false, error: "Prénom et nom requis." });
    }
    const exists = await authUserExistsByEmail(admin, invitationEmail);
    if (exists) {
      return res.status(409).json({
        ok: false,
        error: "Un compte existe déjà avec cet email — connectez-vous pour accepter.",
      });
    }
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: invitationEmail,
      password,
      email_confirm: true,
      user_metadata: {
        gerant_prenom: prenom,
        gerant_nom: nom,
      },
    });
    if (createErr || !created.user?.id) {
      console.error("[accept-invitation] createUser", createErr);
      return res.status(400).json({
        ok: false,
        error: createErr?.message ?? "Impossible de créer le compte.",
      });
    }
    targetUserId = created.user.id;
  } else {
    const jwtUserId = await getAuthUserId(req);
    if (!jwtUserId) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
    const { data: jwtUser } = await admin.auth.admin.getUserById(jwtUserId);
    const jwtEmail = jwtUser?.user?.email?.trim().toLowerCase() ?? "";
    if (jwtEmail !== invitationEmail) {
      return res.status(403).json({ ok: false, error: "Connectez-vous avec l'email invité." });
    }
    targetUserId = jwtUserId;
  }

  if (!targetUserId) {
    return res.status(500).json({ ok: false, error: "Erreur interne." });
  }

  const { data: conflict } = await admin
    .from("membres_concession")
    .select("concession_id")
    .eq("user_id", targetUserId)
    .eq("actif", true)
    .maybeSingle();

  const conflictCid =
    conflict && typeof conflict === "object"
      ? String((conflict as { concession_id?: string }).concession_id ?? "")
      : "";
  if (conflictCid && conflictCid !== concessionTarget) {
    return res.status(409).json({
      ok: false,
      error:
        "Vous êtes déjà rattaché à une autre concession. Quittez-la avant d'en rejoindre une nouvelle.",
    });
  }

  const { error: upMembreErr } = await admin.from("membres_concession").upsert(
    {
      concession_id: concessionTarget,
      user_id: targetUserId,
      role: inviteRole,
      email: invitationEmail,
      prenom: prenom || null,
      nom: nom || null,
      actif: true,
    },
    { onConflict: "concession_id,user_id" },
  );

  if (upMembreErr) {
    console.error("[accept-invitation] membres upsert", upMembreErr);
    return res.status(500).json({ ok: false, error: "Impossible de finaliser l'inscription." });
  }

  await admin
    .from("invitations")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", String(invitation.id ?? ""));

  return res.status(200).json({ ok: true });
}

type AgentRapportEntry = {
  tache: string;
  statut: "ok" | "err" | "warn" | "skip";
  message: string;
  /** PDF CERFA (base64) lorsque la tâche `cerfa` a réussi côté serveur. */
  pdf_base64?: string;
};

function makeResCapture(): {
  res: VercelResponse;
  snapshot: () => { status: number; body: unknown };
} {
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(b: unknown) {
      body = b;
      return res;
    },
  };
  return {
    res: res as unknown as VercelResponse,
    snapshot: () => ({ status, body }),
  };
}

function stripDiacriticsActions(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extractClientTelFromKv(kvStr: Record<string, string>): string {
  const customRaw = kvStr.custom_fields_values;
  if (customRaw) {
    try {
      const obj = JSON.parse(customRaw) as Record<string, unknown>;
      if (obj && typeof obj === "object") {
        for (const [key, val] of Object.entries(obj)) {
          const v = String(val ?? "").trim();
          if (!v) continue;
          const nk = stripDiacriticsActions(key);
          if (
            nk.includes("telephone") ||
            nk.includes("tel") ||
            nk.includes("mobile") ||
            nk.includes("phone")
          ) {
            return v;
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

function normNameAgent(s: string): string {
  return stripDiacriticsActions(s).replace(/\s+/g, " ").trim();
}

type AgentExtractedClient = {
  email?: string;
  nom?: string;
  prenom?: string;
  telephone?: string;
  adresse?: string;
  date_naissance?: string;
};

function isMissingClientsColumnErrorActions(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    (m.includes("could not find") && m.includes("column") && m.includes("clients")) ||
    (m.includes("schema cache") && m.includes("clients"))
  );
}

const CLIENTS_OPTIONAL_INSERT_COLS = [
  "civilite",
  "code_postal",
  "ville",
  "lieu_naissance",
  "numero_cni",
] as const;

/** Insert admin avec retry si colonnes CRM optionnelles absentes (migration non appliquée). */
async function adminInsertClientWithOptionalColumns(
  admin: Awaited<ReturnType<typeof getSupabaseAdmin>>,
  row: Record<string, unknown>,
): Promise<{ data: { id: string } | null; error: { message: string } | null }> {
  let { data, error } = await admin.from("clients").insert(row).select("id").single();
  if (error && isMissingClientsColumnErrorActions(error.message)) {
    const minimal = { ...row };
    for (const k of CLIENTS_OPTIONAL_INSERT_COLS) delete minimal[k];
    console.warn(
      "[agent-post-vente] insert clients sans colonnes optionnelles (exécutez ALTER TABLE sur Supabase)",
    );
    const second = await admin.from("clients").insert(minimal).select("id").single();
    data = second.data as { id: string } | null;
    error = second.error as { message: string } | null;
  }
  return { data: data as { id: string } | null, error: error as { message: string } | null };
}

async function analyserBonAvecIA(
  row: Record<string, unknown>,
  apiKey: string | undefined,
): Promise<{
  client: AgentExtractedClient;
  vehicule: { stock_vehicule_id?: string };
}> {
  const rawKv = row.vehicle_field_values;
  const kvStr: Record<string, string> = {};
  if (rawKv && typeof rawKv === "object") {
    for (const [k, v] of Object.entries(rawKv as Record<string, unknown>)) {
      kvStr[k] = String(v ?? "");
    }
  }
  const base = {
    client: {
      email: String(kvStr.client_email ?? "").trim() || undefined,
      nom: String(row.client_nom ?? "").trim() || undefined,
      prenom: String(row.client_prenom ?? "").trim() || undefined,
      telephone: String(kvStr.client_telephone ?? "").trim() || undefined,
      adresse: String(row.client_adresse ?? "").trim() || undefined,
      date_naissance: String(row.client_date_naissance ?? "").trim() || undefined,
    },
    vehicule: {
      stock_vehicule_id: String(kvStr.vehicule_stock_id ?? "").trim() || undefined,
    },
  };
  if (!apiKey?.trim()) {
    return base;
  }
  const snippet = JSON.stringify({
    client_nom: row.client_nom,
    client_prenom: row.client_prenom,
    client_adresse: row.client_adresse,
    client_date_naissance: row.client_date_naissance,
    vehicule_prix: row.vehicule_prix,
    kv: kvStr,
  }).slice(0, 12000);
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: `Tu analyses un brouillon de bon de commande automobile (JSON ci-dessous).
Réponds UNIQUEMENT par un objet JSON avec les clés :
- "client_email" : string, email acheteur si identifiable, sinon "".
- "client_nom" : string, nom famille acheteur si identifiable, sinon "".
- "client_prenom" : string, prénom acheteur si identifiable, sinon "".
- "client_telephone" : string, téléphone si identifiable, sinon "".
- "client_adresse" : string, adresse postale si identifiable, sinon "".
- "client_date_naissance" : string, date naissance (YYYY-MM-DD ou JJ/MM/AAAA) si identifiable, sinon "".
- "stock_vehicule_id" : string, UUID du véhicule en stock si présent (souvent vehicule_stock_id), sinon "".

Données :
${snippet}`,
          },
        ],
      }),
    });
    if (!openaiRes.ok) {
      console.warn("[agent-post-vente] OpenAI analyse:", openaiRes.status);
      return base;
    }
    const json = (await openaiRes.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim();
    if (!raw) return base;
    const parsed = JSON.parse(raw) as {
      client_email?: string;
      client_nom?: string;
      client_prenom?: string;
      client_telephone?: string;
      client_adresse?: string;
      client_date_naissance?: string;
      stock_vehicule_id?: string;
    };
    const em = String(parsed.client_email ?? "").trim();
    const nomAi = String(parsed.client_nom ?? "").trim();
    const prenomAi = String(parsed.client_prenom ?? "").trim();
    const telAi = String(parsed.client_telephone ?? "").trim();
    const adrAi = String(parsed.client_adresse ?? "").trim();
    const dnAi = String(parsed.client_date_naissance ?? "").trim();
    const sid = String(parsed.stock_vehicule_id ?? "").trim();
    return {
      client: {
        email: em || base.client.email,
        nom: nomAi || base.client.nom,
        prenom: prenomAi || base.client.prenom,
        telephone: telAi || base.client.telephone,
        adresse: adrAi || base.client.adresse,
        date_naissance: dnAi || base.client.date_naissance,
      },
      vehicule: {
        stock_vehicule_id: sid || base.vehicule.stock_vehicule_id,
      },
    };
  } catch (err) {
    console.warn("[agent-post-vente] analyserBonAvecIA:", err);
    return base;
  }
}

function buildCerfaPayloadFromBrouillon(
  row: Record<string, unknown>,
  prof: Record<string, unknown> | null,
  agentCerfa?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const rawKv = row.vehicle_field_values;
  const kvStr: Record<string, string> = {};
  if (rawKv && typeof rawKv === "object") {
    for (const [k, v] of Object.entries(rawKv as Record<string, unknown>)) {
      kvStr[k] = String(v ?? "");
    }
  }
  const stockDonnees = parseStringDict(
    (rawKv as Record<string, unknown> | undefined)?.stock_donnees,
  );
  const immat = extractVehiculeField(stockDonnees, [
    "immat",
    "immatriculation",
    "plaque",
    "numero_immat",
  ]);
  const vinStock = extractVehiculeField(stockDonnees, ["vin", "VIN", "chassis", "châssis"]);
  const marque = pickStockField(stockDonnees, ["marque", "brand"]);
  const modele = pickStockField(stockDonnees, ["modele", "modèle", "model"]);
  const km = extractVehiculeField(stockDonnees, [
    "km",
    "kilometrage",
    "kilométrage",
    "kms",
  ]);
  const prem = extractVehiculeField(stockDonnees, [
    "premiere_mise_en_circulation",
    "première mise en circulation",
    "date_mec",
    "mec",
  ]);
  const formuleStock = extractVehiculeField(stockDonnees, [
    "formule",
    "numero_formule",
    "numéro_formule",
    "n_formule",
    "numero_formule_carte_grise",
    "carte_grise_formule",
  ]).slice(0, 9);

  const ag = agentCerfa ?? {};
  const vinAgent = String(ag.vin ?? "").trim().slice(0, 17);
  const vinFinal = (vinAgent || vinStock).trim().slice(0, 17);
  const formuleAgent = String(ag.numero_formule ?? "").trim().slice(0, 9);
  const numeroFormuleFinal = (formuleAgent || formuleStock).trim().slice(0, 9);

  const civRaw = String(ag.acheteur_civilite ?? "m").toLowerCase().trim();
  let acheteurType: "physique" | "morale" = "physique";
  let acheteurSexe = "M";
  if (civRaw === "morale" || civRaw === "personne_morale" || civRaw === "pm") {
    acheteurType = "morale";
    acheteurSexe = "M";
  } else if (civRaw === "mme" || civRaw === "f") {
    acheteurType = "physique";
    acheteurSexe = "F";
  } else {
    acheteurType = "physique";
    acheteurSexe = "M";
  }

  const acheteurCp = String(ag.acheteur_code_postal ?? "").trim();
  const acheteurVille = String(ag.acheteur_ville ?? "").trim();
  const acheteurLieuNaiss = String(ag.acheteur_lieu_naissance ?? "").trim();

  const nom = String(row.client_nom ?? "").trim();
  const prenom = String(row.client_prenom ?? "").trim();
  const adresse = String(row.client_adresse ?? "").trim();
  const dn = String(row.client_date_naissance ?? "").trim();
  const concessionNom = String(prof?.nom_concession ?? "").trim() || "Concession";
  const cpVille = [
    String(prof?.code_postal ?? "").trim(),
    String(prof?.ville ?? "").trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const vendAdresse = [
    String(prof?.adresse ?? "").trim(),
    cpVille,
  ]
    .filter(Boolean)
    .join(", ");
  const siret = String(prof?.siret ?? prof?.siren ?? "").trim();
  const today = new Date();
  const d = today.toISOString().slice(0, 10);
  const parts = d.split("-");
  const cessionDate =
    parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : "";

  if (!immat || !nom || !adresse) {
    return null;
  }

  return {
    vendeur_force_morale: true,
    vendeur_is_personne_morale: true,
    vendeur_civilite: "personne_morale",
    vendeur_genre: null,
    immatriculation: immat,
    vin: vinFinal || undefined,
    numero_formule: numeroFormuleFinal || undefined,
    date_mise_en_circulation: prem || undefined,
    marque: marque || "—",
    type_variante: "",
    genre: "VP",
    denomination: modele || "—",
    kilometrage: km || "—",
    vendeur_type: "morale",
    vendeur_nom: concessionNom,
    vendeur_siren: siret.slice(0, 9) || undefined,
    vendeur_adresse: vendAdresse || "—",
    vendeur_code_postal: String(prof?.code_postal ?? "").trim() || "00000",
    vendeur_ville: String(prof?.ville ?? "").trim() || "—",
    cession_date: cessionDate,
    cession_heure: "12",
    cession_lieu: String(prof?.ville ?? "").trim() || "—",
    certif_situation_admin: true,
    certif_pas_transformation: true,
    certif_vhu: false,
    acheteur_type: acheteurType,
    acheteur_sexe: acheteurSexe,
    acheteur_nom: nom,
    acheteur_prenom: prenom,
    acheteur_date_naissance: dn || undefined,
    acheteur_lieu_naissance: acheteurLieuNaiss || undefined,
    acheteur_adresse: adresse,
    acheteur_code_postal: acheteurCp || "00000",
    acheteur_ville: acheteurVille || "—",
    acheteur_cert_acquerir: true,
    acheteur_cert_informe: true,
    opposition_prospection: false,
  };
}

async function handleAgentPostVente(
  req: VercelRequest,
  body: Record<string, unknown>,
  res: VercelResponse,
) {
  console.log("BODY COMPLET REÇU:", JSON.stringify(body));
  console.log("TACHES COMPLÈTES:", JSON.stringify(body.taches));
  const t0 = Date.now();
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  console.log("=== AGENT REÇU ===");
  console.log("body.taches:", JSON.stringify(body.taches ?? null));

  const brouillonId = String(body.brouillon_id ?? "").trim();
  if (!brouillonId) return res.status(400).json({ error: "brouillon_id requis" });

  const tachesRaw = body.taches;
  const taches =
    tachesRaw && typeof tachesRaw === "object"
      ? (tachesRaw as Record<string, unknown>)
      : {};
  const enregistrer_client = taches.enregistrer_client === true;
  const envoyer_bon_email = taches.envoyer_bon_email === true;
  const generer_facture = taches.generer_facture === true;
  const envoyer_facture_email = taches.envoyer_facture_email === true;
  const marquer_vendu = taches.marquer_vendu === true;
  const generer_cerfa = taches.generer_cerfa === true;
  console.log("[agent-post-vente] taches reçues raw:", JSON.stringify(taches));
  console.log("[agent-post-vente] flags parsés:", { enregistrer_client, envoyer_bon_email, generer_facture, envoyer_facture_email, marquer_vendu, generer_cerfa });

  const pdfBase64 = String(body.pdf_base64 ?? "").trim();
  const formData =
    body.form_data && typeof body.form_data === "object"
      ? (body.form_data as Record<string, string>)
      : ({} as Record<string, string>);
  const signatureVendeurBase64 = String(body.signature_vendeur_base64 ?? "").trim();
  const bonEmailDejaEnvoye = body.bon_email_deja_envoye === true;
  const clientEmailMeta = String(body.client_email ?? "").trim();
  const clientNomMeta = String(body.client_nom ?? "").trim();
  const clientPrenomMeta = String(body.client_prenom ?? "").trim();
  const vehiculeModeleMeta = String(body.vehicule_modele ?? "").trim() || "Véhicule";
  const vendeurEmailMeta = String(body.vendeur_email ?? "").trim();
  const vendeurNomMeta = String(body.vendeur_nom ?? "").trim() || "Votre conseiller";

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  const clientConcessionId =
    body.concession_id != null ? String(body.concession_id).trim() : "";
  if (clientConcessionId && clientConcessionId !== concessionId) {
    console.warn("[agent-post-vente] concession_id client ≠ serveur");
  }

  const { data: row, error: brErr } = await admin
    .from("brouillons")
    .select("*")
    .eq("id", brouillonId)
    .eq("concession_id", concessionId)
    .maybeSingle();

  if (brErr) {
    console.error("[agent-post-vente] brouillon:", brErr);
    return res.status(500).json({ error: "Erreur lecture brouillon" });
  }
  if (!row || typeof row !== "object") {
    return res.status(404).json({ error: "Brouillon introuvable" });
  }

  const br = row as Record<string, unknown>;
  const rapport: AgentRapportEntry[] = [];
  const erreurs: { tache: string; detail: string }[] = [];

  const apiKey = process.env.OPENAI_API_KEY;
  let extracted: Awaited<ReturnType<typeof analyserBonAvecIA>>;
  try {
    extracted = await analyserBonAvecIA(br, apiKey?.trim() ? apiKey : undefined);
    rapport.push({
      tache: "analyse",
      statut: "ok",
      message: "Données analysées",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analyse impossible";
    rapport.push({ tache: "analyse", statut: "err", message: msg });
    erreurs.push({ tache: "analyse", detail: msg });
    extracted = await analyserBonAvecIA(br, undefined);
  }

  const rawKv = br.vehicle_field_values;
  const kvStr: Record<string, string> = {};
  if (rawKv && typeof rawKv === "object") {
    for (const [k, v] of Object.entries(rawKv as Record<string, unknown>)) {
      kvStr[k] = String(v ?? "");
    }
  }

  const emailClientEffectif =
    extracted.client.email?.trim() ||
    clientEmailMeta ||
    String(kvStr.client_email ?? "").trim();

  console.log("[agent-post-vente] Tâche enregistrer_client:", enregistrer_client);
  console.log("[agent-post-vente] Données client extraites:", extracted?.client);
  console.log("[agent-post-vente] concession_id:", concessionId);
  console.log("[agent-post-vente] taches reçues:", JSON.stringify(taches));

  if (enregistrer_client) {
    try {
      const nom = String(extracted.client?.nom ?? br.client_nom ?? "").trim();
      const prenom = String(extracted.client?.prenom ?? br.client_prenom ?? "").trim();

      if (!nom || !prenom) {
        rapport.push({
          tache: "client",
          statut: "warn",
          message: "Fiche client : nom ou prénom manquant (brouillon ou analyse IA)",
        });
      } else if (br.client_id) {
        rapport.push({
          tache: "client",
          statut: "ok",
          message: "Fiche client déjà enregistrée",
        });
      } else {
        const { data: hits } = await admin
          .from("clients")
          .select("id, nom, prenom")
          .eq("concession_id", concessionId)
          .ilike("nom", nom)
          .ilike("prenom", prenom)
          .limit(20);
        let existingId: string | null = null;
        for (const h of hits ?? []) {
          const r = h as { id?: string; nom?: string; prenom?: string };
          if (
            normNameAgent(String(r.nom ?? "")) === normNameAgent(nom) &&
            normNameAgent(String(r.prenom ?? "")) === normNameAgent(prenom)
          ) {
            existingId = String(r.id ?? "");
            break;
          }
        }

        const tel =
          String(extracted.client?.telephone ?? "").trim() ||
          String(kvStr.client_telephone ?? "").trim() ||
          extractClientTelFromKv(kvStr);
        const emailCrm =
          String(extracted.client?.email ?? "").trim() || emailClientEffectif || null;
        const adresseCrm =
          String(extracted.client?.adresse ?? "").trim() ||
          String(br.client_adresse ?? "").trim() ||
          null;
        const dateNaissCrm =
          String(extracted.client?.date_naissance ?? "").trim() ||
          String(br.client_date_naissance ?? "").trim() ||
          null;
        const lieuNaissUpd = String(kvStr.cerfa_acheteur_lieu_naissance ?? "").trim() || null;
        const numeroCniUpd = String(br.client_numero_cni ?? "").trim() || null;

        if (existingId) {
          const { error: updErr } = await admin
            .from("clients")
            .update({
              email: emailCrm,
              telephone: tel || null,
              adresse: adresseCrm,
              date_naissance: dateNaissCrm,
              lieu_naissance: lieuNaissUpd,
              numero_cni: numeroCniUpd,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingId);
          if (updErr) {
            const m = updErr.message ?? "update client";
            rapport.push({ tache: "client", statut: "err", message: m });
            erreurs.push({ tache: "client", detail: m });
          } else {
            await admin
              .from("brouillons")
              .update({ client_id: existingId })
              .eq("id", brouillonId)
              .eq("concession_id", concessionId);
            rapport.push({
              tache: "client",
              statut: "ok",
              message: "Fiche client mise à jour",
            });
          }
        } else {
          const civRaw = String(kvStr.cerfa_acheteur_civilite ?? "").trim().toLowerCase();
          const civ =
            civRaw === "m" || civRaw === "mme" || civRaw === "morale" ? civRaw : null;
          const cpCl = String(kvStr.cerfa_acheteur_code_postal ?? "").trim() || null;
          const villeCl = String(kvStr.cerfa_acheteur_ville ?? "").trim() || null;
          const lieuNaiss = String(kvStr.cerfa_acheteur_lieu_naissance ?? "").trim() || null;
          const numeroCniIns = String(br.client_numero_cni ?? "").trim() || null;

          const insertRow: Record<string, unknown> = {
            concession_id: concessionId,
            nom,
            prenom,
            email: emailCrm,
            telephone: tel || null,
            adresse: adresseCrm,
            date_naissance: dateNaissCrm,
            civilite: civ,
            code_postal: cpCl,
            ville: villeCl,
            lieu_naissance: lieuNaiss,
            numero_cni: numeroCniIns,
          };

          const { data: nouveau, error: createError } =
            await adminInsertClientWithOptionalColumns(admin, insertRow);

          console.log("[agent-post-vente] Nouveau client créé:", nouveau, "Erreur:", createError);

          if (createError || !nouveau?.id) {
            const d = createError?.message ?? "insert client";
            rapport.push({ tache: "client", statut: "err", message: d });
            erreurs.push({ tache: "client", detail: d });
          } else {
            await admin
              .from("brouillons")
              .update({ client_id: String(nouveau.id) })
              .eq("id", brouillonId)
              .eq("concession_id", concessionId);
            rapport.push({
              tache: "client",
              statut: "ok",
              message: "Fiche client créée dans le CRM",
            });
          }
        }
      }
    } catch (e: unknown) {
      console.error("[agent-post-vente] Erreur client agent:", e);
      const msg = e instanceof Error ? e.message : String(e);
      rapport.push({
        tache: "client",
        statut: "err",
        message: `Erreur client: ${msg}`,
      });
      erreurs.push({ tache: "client", detail: msg });
    }
  }

  if (envoyer_bon_email) {
    if (bonEmailDejaEnvoye) {
      rapport.push({
        tache: "bon_email",
        statut: "ok",
        message: "Bon déjà envoyé par email (étape précédente)",
      });
    } else if (!pdfBase64) {
      rapport.push({
        tache: "bon_email",
        statut: "skip",
        message: "Envoi bon : PDF non fourni",
      });
    } else if (!emailClientEffectif || !isValidEmail(emailClientEffectif)) {
      rapport.push({
        tache: "bon_email",
        statut: "skip",
        message: "Envoi bon : email client manquant ou invalide",
      });
    } else {
      try {
        const cap = makeResCapture();
        await handleSendEmail(
          req,
          {
            pdfBase64,
            clientEmail: emailClientEffectif,
            clientNom: clientNomMeta || String(br.client_nom ?? ""),
            clientPrenom: clientPrenomMeta || String(br.client_prenom ?? ""),
            vehiculeModele: vehiculeModeleMeta,
            vendeurNom: vendeurNomMeta,
            vendeurEmail: vendeurEmailMeta,
            brouillonId,
            formData,
            signatureVendeurBase64: signatureVendeurBase64 || undefined,
          } as unknown as Record<string, unknown>,
          cap.res,
        );
        const sn = cap.snapshot();
        if (sn.status === 200) {
          rapport.push({
            tache: "bon_email",
            statut: "ok",
            message: "Bon de commande envoyé par email",
          });
        } else {
          const errBody = sn.body as { error?: string } | undefined;
          const em = errBody?.error ?? `HTTP ${sn.status}`;
          rapport.push({ tache: "bon_email", statut: "err", message: em });
          erreurs.push({ tache: "bon_email", detail: em });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Email bon";
        rapport.push({ tache: "bon_email", statut: "err", message: msg });
        erreurs.push({ tache: "bon_email", detail: msg });
      }
    }
  }

  let factureId: string | null = null;
  let numeroFactureOut: string | null = null;

  if (generer_facture) {
    try {
      const cap = makeResCapture();
      await handleGenerateFacture(
        req,
        {
          brouillon_id: brouillonId,
          client_email: emailClientEffectif || undefined,
          client_adresse: String(br.client_adresse ?? "").trim() || undefined,
          client_telephone: String(kvStr.client_telephone ?? "").trim() || undefined,
        },
        cap.res,
      );
      const sn = cap.snapshot();
      const b = sn.body as {
        factureId?: string;
        numero_facture?: string;
        error?: string;
        duplicate?: boolean;
      };
      if (sn.status === 200 && (b.factureId || b.numero_facture)) {
        factureId = b.factureId ? String(b.factureId) : null;
        numeroFactureOut = b.numero_facture ? String(b.numero_facture) : null;
        rapport.push({
          tache: "facture",
          statut: "ok",
          message: numeroFactureOut
            ? `Facture ${numeroFactureOut} générée`
            : "Facture générée",
        });
      } else {
        const em = b.error ?? `Erreur facture (${sn.status})`;
        rapport.push({ tache: "facture", statut: "err", message: em });
        erreurs.push({ tache: "facture", detail: em });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Facture";
      rapport.push({ tache: "facture", statut: "err", message: msg });
      erreurs.push({ tache: "facture", detail: msg });
    }
  }

  if (envoyer_facture_email && generer_facture) {
    if (!factureId) {
      rapport.push({
        tache: "facture_email",
        statut: "skip",
        message: "Envoi facture : aucune facture générée",
      });
    } else if (!emailClientEffectif || !isValidEmail(emailClientEffectif)) {
      rapport.push({
        tache: "facture_email",
        statut: "skip",
        message: "Envoi facture : email client manquant",
      });
    } else {
      try {
        const cap = makeResCapture();
        await handleSendFactureEmail(
          req,
          { facture_id: factureId, client_email: emailClientEffectif },
          cap.res,
        );
        const sn = cap.snapshot();
        if (sn.status === 200) {
          rapport.push({
            tache: "facture_email",
            statut: "ok",
            message: "Facture envoyée par email",
          });
        } else {
          const errBody = sn.body as { error?: string } | undefined;
          const em = errBody?.error ?? `HTTP ${sn.status}`;
          rapport.push({ tache: "facture_email", statut: "err", message: em });
          erreurs.push({ tache: "facture_email", detail: em });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Email facture";
        rapport.push({ tache: "facture_email", statut: "err", message: msg });
        erreurs.push({ tache: "facture_email", detail: msg });
      }
    }
  }

  if (marquer_vendu) {
    const vid =
      String(extracted.vehicule.stock_vehicule_id ?? "").trim() ||
      String(kvStr.vehicule_stock_id ?? "").trim();
    if (!vid) {
      rapport.push({
        tache: "vendu",
        statut: "skip",
        message: "Stock : aucun véhicule lié au bon",
      });
    } else {
      try {
        const { data: upd, error: upErr } = await admin
          .from("stock_vehicules")
          .update({
            statut: "vendu",
            disponible: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", vid)
          .eq("concession_id", concessionId)
          .select("id")
          .maybeSingle();
        if (upErr || !upd) {
          const em = upErr?.message ?? "Mise à jour stock refusée";
          rapport.push({ tache: "vendu", statut: "err", message: em });
          erreurs.push({ tache: "vendu", detail: em });
        } else {
          rapport.push({
            tache: "vendu",
            statut: "ok",
            message: "Véhicule marqué comme vendu",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stock";
        rapport.push({ tache: "vendu", statut: "err", message: msg });
        erreurs.push({ tache: "vendu", detail: msg });
      }
    }
  }

  if (generer_cerfa) {
    try {
      const { data: profil } = await admin
        .from("profil_concession")
        .select("*")
        .eq("concession_id", concessionId)
        .maybeSingle();
      const prof = (profil ?? null) as Record<string, unknown> | null;
      const cerfaAgentFromKv: Record<string, unknown> = {
        vin: String(kvStr.cerfa_vin_complement ?? "").trim(),
        numero_formule: String(kvStr.cerfa_formule_carte_grise ?? "").trim(),
        acheteur_civilite: String(kvStr.cerfa_acheteur_civilite ?? "m").trim().toLowerCase() || "m",
        acheteur_code_postal: String(kvStr.cerfa_acheteur_code_postal ?? "").trim(),
        acheteur_ville: String(kvStr.cerfa_acheteur_ville ?? "").trim(),
        acheteur_lieu_naissance: String(kvStr.cerfa_acheteur_lieu_naissance ?? "").trim(),
      };
      const cerfaPayload = buildCerfaPayloadFromBrouillon(br, prof, cerfaAgentFromKv);
      if (!cerfaPayload) {
        rapport.push({
          tache: "cerfa",
          statut: "warn",
          message: "CERFA : données insuffisantes (immatriculation ou adresse acheteur)",
        });
      } else {
        const cap = makeResCapture();
        await handleFillCerfa(req, { cerfa_data: cerfaPayload }, cap.res);
        const sn = cap.snapshot();
        if (sn.status === 200) {
          const okBody = sn.body as { pdf_base64?: string } | undefined;
          const pdfCerfa = String(okBody?.pdf_base64 ?? "").trim();
          console.log("CERFA généré, pdf_base64 length:", pdfCerfa?.length);
          const warnEmail = !emailClientEffectif;
          if (pdfCerfa) {
            console.log("Sauvegarde CERFA en base...");
            const { error: cerfaError } = await admin.from("cerfas").insert({
              user_id: userId,
              concession_id: concessionId,
              brouillon_id: brouillonId,
              pdf_base64: pdfCerfa,
              cerfa_data: cerfaPayload,
              created_by: userId,
            });
            if (cerfaError) {
              console.error("Erreur sauvegarde CERFA:", cerfaError);
              rapport.push({
                tache: "cerfa",
                statut: "warn",
                message: "CERFA généré mais non sauvegardé en historique",
                pdf_base64: pdfCerfa,
              });
            } else {
              rapport.push({
                tache: "cerfa",
                statut: warnEmail ? "warn" : "ok",
                message: warnEmail
                  ? "CERFA généré et sauvegardé — email client manquant (envoi non effectué)"
                  : "CERFA généré et sauvegardé",
                pdf_base64: pdfCerfa,
              });
            }
          } else {
            rapport.push({
              tache: "cerfa",
              statut: warnEmail ? "warn" : "ok",
              message: warnEmail
                ? "CERFA : email client manquant (PDF généré, envoi non effectué)"
                : "CERFA généré",
            });
          }
        } else {
          const errBody = sn.body as { error?: string } | undefined;
          const em = errBody?.error ?? `CERFA ${sn.status}`;
          rapport.push({ tache: "cerfa", statut: "err", message: em });
          erreurs.push({ tache: "cerfa", detail: em });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CERFA";
      rapport.push({ tache: "cerfa", statut: "err", message: msg });
      erreurs.push({ tache: "cerfa", detail: msg });
    }
  }

  const executedAt = new Date().toISOString();
  try {
    await admin
      .from("brouillons")
      .update({
        agent_ia_executed_at: executedAt,
        agent_ia_rapport: rapport,
      })
      .eq("id", brouillonId)
      .eq("concession_id", concessionId);
  } catch (updErr) {
    console.warn("[agent-post-vente] update agent_ia_*:", updErr);
  }

  return res.status(200).json({
    success: true,
    rapport,
    erreurs,
    duration_ms: Date.now() - t0,
  });
}

async function handleExportLivrePolice(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  const bodyClientCid = data.concession_id != null ? String(data.concession_id).trim() : "";
  if (bodyClientCid && bodyClientCid !== concessionId) {
    console.warn("[export-livre-police] concession_id client ≠ serveur");
  }

  console.log("export-livre-police body:", data);
  console.log("concession_id (body client data.concession_id):", data.concession_id);
  console.log("concession_id (membres actifs serveur):", concessionId);
  console.log("auth userId:", userId);

  const filtresRaw = data.filtres;
  const filtres =
    filtresRaw && typeof filtresRaw === "object"
      ? (filtresRaw as Record<string, unknown>)
      : {};
  const statutFiltre = String(filtres.statut ?? "tous").trim() || "tous";
  const entreeId = String(data.entree_id ?? "").trim();

  let q = admin.from("livre_de_police").select("*").eq("concession_id", concessionId);
  if (entreeId) {
    q = q.eq("id", entreeId);
  }
  q = q.order("numero_ordre", { ascending: true });

  const { data: entrees, error } = await q;

  console.log("Entrées trouvées:", entrees?.length);
  console.log("Erreur:", error);
  console.log("Première entrée:", entrees?.[0]);

  if (error) {
    console.error("[export-livre-police] select:", error);
    return res.status(500).json({ error: "Lecture livre de police impossible." });
  }

  let rows = (entrees ?? []) as Record<string, unknown>[];

  if (rows.length === 0 && userId && String(userId) !== String(concessionId)) {
    let qUid = admin.from("livre_de_police").select("*").eq("concession_id", userId);
    if (entreeId) {
      qUid = qUid.eq("id", entreeId);
    }
    qUid = qUid.order("numero_ordre", { ascending: true });
    const { data: entreesUid, error: errUid } = await qUid;
    console.log(
      "[export-livre-police] fallback concession_id=auth.uid — count:",
      entreesUid?.length,
      "err:",
      errUid,
    );
    if (!errUid && entreesUid?.length) {
      rows = entreesUid as Record<string, unknown>[];
    }
  }

  if (!entreeId && statutFiltre === "en_stock") {
    rows = rows.filter((e) => !e.date_sortie);
  } else if (!entreeId && statutFiltre === "vendu") {
    rows = rows.filter((e) => !!e.date_sortie);
  }

  const { data: profil } = await admin
    .from("profil_concession")
    .select("nom_concession, siret, siren")
    .eq("concession_id", concessionId)
    .maybeSingle();
  const prof = (profil ?? null) as Record<string, unknown> | null;
  const concessionInfo = {
    nom: String(prof?.nom_concession ?? "").trim(),
    siret: String(prof?.siret ?? prof?.siren ?? "").trim(),
  };

  let html: string;
  try {
    html = buildLivrePoliceHTML(rows, concessionInfo);
  } catch (err) {
    console.error("[export-livre-police] template:", err);
    return res.status(500).json({ error: "Erreur rendu HTML." });
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPdfFromHtml(html, {
      landscape: true,
      margin: { top: "15mm", bottom: "15mm", left: "10mm", right: "10mm" },
    });
  } catch (err) {
    console.error("[export-livre-police] pdf:", err);
    return res.status(500).json({ error: "Erreur génération PDF." });
  }

  return res.status(200).json({ pdf_base64: pdfBuffer.toString("base64") });
}

async function handleEstimerReprise(
  req: VercelRequest,
  data: Record<string, unknown>,
  res: VercelResponse,
) {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: "Non autorisé" });

  const admin = await getSupabaseAdmin();
  const concessionId = await getActiveConcessionIdForUser(admin, userId);
  if (!concessionId) {
    return res.status(403).json({ error: "Aucune concession active pour ce compte." });
  }

  const marque = String(data.marque ?? "").trim();
  const modele = String(data.modele ?? "").trim();
  const kilometrage = String(data.kilometrage ?? "").trim();
  const annee = String(data.annee ?? "").trim();
  const energie = String(data.energie ?? "").trim();
  const version = String(data.version ?? "").trim();

  if (!marque || !modele) {
    return res.status(400).json({
      error: "Marque et modèle requis",
    });
  }

  const openAiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!openAiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY manquante." });
  }

  const prompt = `
Tu es un expert en évaluation de véhicules d'occasion 
pour le marché français.

Estime le prix de reprise pour ce véhicule :
- Marque : ${marque}
- Modèle : ${modele}
- Version/Finition : ${version || "Non précisée"}
- Année : ${annee || "Non précisée"}
- Kilométrage : ${kilometrage || "Non précisé"} km
- Énergie : ${energie || "Non précisée"}

Donne une estimation RÉALISTE basée sur :
1. La cote Argus approximative
2. L'état du marché de l'occasion en France
3. La décote kilométrique standard

Retourne UNIQUEMENT ce JSON :
{
  "prix_min": 12000,
  "prix_max": 14500,
  "prix_recommande": 13200,
  "fiabilite": "haute|moyenne|faible",
  "explication": "Courte explication de 1-2 phrases",
  "facteurs": [
    "Point positif ou négatif qui influence le prix"
  ]
}

Valeurs en euros entiers, sans symbole.
Si les infos sont insuffisantes pour estimer, 
mets fiabilite: "faible" et une fourchette large.
Retourne UNIQUEMENT le JSON, rien d'autre.
  `;

  let openaiRes: Response;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0.3,
      }),
    });
  } catch (e) {
    console.error("[estimer-reprise] fetch OpenAI:", e);
    return res.status(502).json({ error: "Impossible de joindre OpenAI." });
  }

  const openaiData = (await openaiRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!openaiRes.ok) {
    const errMsg =
      typeof openaiData.error === "object" && openaiData.error !== null
        ? String((openaiData.error as { message?: unknown }).message ?? openaiRes.status)
        : String(openaiData.error ?? `OpenAI ${openaiRes.status}`);
    console.warn("[estimer-reprise] OpenAI:", openaiRes.status, errMsg);
    return res.status(502).json({ error: errMsg || "Erreur OpenAI." });
  }

  const choices = openaiData.choices as unknown[] | undefined;
  const first = choices?.[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const rawContent = String(message?.content ?? "").trim();
  if (!rawContent) {
    return res.status(502).json({ error: "Réponse OpenAI vide." });
  }

  const text = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    console.warn("[estimer-reprise] JSON parse:", e, text.slice(0, 200));
    return res.status(502).json({ error: "Réponse IA non exploitable (JSON invalide)." });
  }

  const toInt = (v: unknown): number => {
    const n = Math.round(Number.parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")));
    return Number.isFinite(n) ? n : NaN;
  };

  const prix_min = toInt(parsed.prix_min);
  const prix_max = toInt(parsed.prix_max);
  const prix_recommande = toInt(parsed.prix_recommande);
  const fiabiliteRaw = String(parsed.fiabilite ?? "faible").toLowerCase();
  const fiabilite =
    fiabiliteRaw === "haute" || fiabiliteRaw === "moyenne" || fiabiliteRaw === "faible"
      ? fiabiliteRaw
      : "faible";
  const explication = String(parsed.explication ?? "").trim() || "—";
  const facteursRaw = parsed.facteurs;
  const facteurs = Array.isArray(facteursRaw)
    ? facteursRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];

  if (!Number.isFinite(prix_min) || !Number.isFinite(prix_max) || !Number.isFinite(prix_recommande)) {
    return res.status(502).json({ error: "Estimation incomplète renvoyée par le modèle." });
  }

  const estimation = {
    prix_min,
    prix_max,
    prix_recommande,
    fiabilite,
    explication,
    facteurs,
  };

  return res.status(200).json({
    success: true,
    estimation,
  });
}

async function handleSendWelcomeEmail(data: Record<string, unknown>, res: VercelResponse) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "RESEND_API_KEY manquante." });
  }

  const email = String(data.email ?? "").trim();
  const prenomRaw = String(data.prenom ?? "").trim();
  const prenomHtml = prenomRaw ? ` ${escapeHtml(prenomRaw)}` : "";

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: "email invalide" });
  }

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: "AutoDocs <noreply@autodocs.services>",
      to: email,
      subject: "🚗 Bienvenue sur AutoDocs !",
      html: `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 
                   'Segoe UI', Arial, sans-serif;
      background: #0a0a14;
      color: #f1f5f9;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .logo {
      text-align: center;
      margin-bottom: 40px;
    }
    .logo-text {
      font-size: 24px;
      font-weight: 700;
      color: #818cf8;
      letter-spacing: -0.5px;
    }
    .hero {
      background: linear-gradient(135deg, #1a1a35, #1e1b4b);
      border: 1px solid rgba(99,102,241,0.3);
      border-radius: 16px;
      padding: 40px;
      text-align: center;
      margin-bottom: 32px;
    }
    .emoji { font-size: 48px; margin-bottom: 16px; }
    h1 { 
      font-size: 28px; 
      font-weight: 700;
      color: #f1f5f9;
      margin-bottom: 12px;
    }
    .subtitle {
      color: #94a3b8;
      font-size: 16px;
      line-height: 1.6;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: white !important;
      text-decoration: none;
      padding: 16px 32px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 16px;
      margin-top: 24px;
    }
    .steps {
      background: #111127;
      border: 1px solid rgba(99,102,241,0.15);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
    }
    .steps h2 {
      font-size: 18px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 20px;
    }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 20px;
    }
    .step:last-child { margin-bottom: 0; }
    .step-number {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      flex-shrink: 0;
      color: white;
    }
    .step-content h3 {
      font-size: 15px;
      font-weight: 600;
      color: #f1f5f9;
      margin-bottom: 4px;
    }
    .step-content p {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
    }
    .features {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .feature {
      background: #111127;
      border: 1px solid rgba(99,102,241,0.15);
      border-radius: 12px;
      padding: 16px;
    }
    .feature-icon { font-size: 24px; margin-bottom: 8px; }
    .feature h3 { font-size: 13px; font-weight: 600; color: #f1f5f9; }
    .feature p { font-size: 12px; color: #94a3b8; margin-top: 4px; }
    .footer {
      text-align: center;
      color: #475569;
      font-size: 12px;
      padding-top: 24px;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    .footer a { color: #6366f1; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- Logo -->
    <div class="logo">
      <span class="logo-text">🚗 AutoDocs</span>
    </div>

    <!-- Hero -->
    <div class="hero">
      <div class="emoji">🎉</div>
      <h1>Bienvenue${prenomHtml} !</h1>
      <p class="subtitle">
        Votre compte AutoDocs est prêt.<br>
        Vous êtes à quelques minutes de transformer 
        la gestion administrative de votre concession.
      </p>
      <a href="https://autodocs-eight.vercel.app/dashboard" 
         class="cta-button">
        Accéder à mon espace →
      </a>
    </div>

    <!-- Guide démarrage -->
    <div class="steps">
      <h2>🚀 Démarrez en 3 étapes</h2>
      
      <div class="step">
        <div class="step-number">1</div>
        <div class="step-content">
          <h3>Configurez votre concession</h3>
          <p>Renseignez le nom, SIRET et adresse de votre 
             concession dans "Ma concession". Ces infos 
             apparaîtront sur vos bons de commande et factures.</p>
        </div>
      </div>

      <div class="step">
        <div class="step-number">2</div>
        <div class="step-content">
          <h3>Importez votre stock de véhicules</h3>
          <p>Importez votre stock via CSV/Excel dans 
             "Stock véhicules". Compatible avec tous 
             les formats d'export.</p>
        </div>
      </div>

      <div class="step">
        <div class="step-number">3</div>
        <div class="step-content">
          <h3>Créez votre premier bon de commande</h3>
          <p>Cliquez sur "Nouveau bon", sélectionnez 
             un véhicule, remplissez les infos client 
             et générez votre premier bon en 2 minutes.</p>
        </div>
      </div>
    </div>

    <!-- Features -->
    <div class="features">
      <div class="feature">
        <div class="feature-icon">🤖</div>
        <h3>Agent IA post-vente</h3>
        <p>Automatise tout après la signature</p>
      </div>
      <div class="feature">
        <div class="feature-icon">✍️</div>
        <h3>Signature électronique</h3>
        <p>Le client signe depuis son téléphone</p>
      </div>
      <div class="feature">
        <div class="feature-icon">🧾</div>
        <h3>Facturation légale</h3>
        <p>PDF conformes envoyés automatiquement</p>
      </div>
      <div class="feature">
        <div class="feature-icon">📋</div>
        <h3>Livre de police</h3>
        <p>Registre légal numérique conforme</p>
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>
        Vous recevez cet email car vous venez de créer 
        un compte sur AutoDocs.<br>
        <a href="https://autodocs.services">autodocs.services</a> · 
        <a href="https://autodocs-eight.vercel.app/cgu">CGU</a> · 
        <a href="https://autodocs-eight.vercel.app/confidentialite">
          Confidentialité
        </a>
      </p>
      <p style="margin-top: 8px;">
        © 2026 AutoDocs — Fait avec ❤️ pour les concessions françaises
      </p>
    </div>

  </div>
</body>
</html>
    `,
    });

    if (error) {
      console.error("[send-welcome-email] resend:", error);
      return res.status(500).json({ error: error.message || "Echec d'envoi email" });
    }
  } catch (e) {
    console.error("[send-welcome-email]", e);
    return res.status(500).json({ error: "Echec d'envoi email" });
  }

  return res.status(200).json({ success: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const parsed = parseRequestBody(req);
  if (parsed === null) {
    return res.status(400).json({ error: "JSON invalide" });
  }

  const { action, ...data } = parsed;
  const actionName = String(action ?? "").trim();

  if (actionName === "generate-briefing") {
    const rawAuth = req.headers.authorization;
    const authHeader = typeof rawAuth === "string" ? rawAuth : "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return res.status(401).json({ error: "Non authentifié" });
    }
    const supabaseAdmin = await getSupabaseAdmin();
    const {
      data: { user },
      error: authUserError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authUserError || !user) {
      return res.status(401).json({ error: "Non authentifié" });
    }
  }

  switch (actionName) {
    case "send-email":
      return handleSendEmail(req, data, res);
    case "embed-signature":
      return handleEmbedSignature(data, res);
    case "complete-signature":
      return handleCompleteSignature(data, res);
    case "resend-signature-email":
      return handleResendSignatureEmail(req, data, res);
    case "send-relances":
      return handleSendRelances(req, data, res);
    case "generate-briefing":
      return handleGenerateBriefing(req, data, res);
    case "save-relances-config":
      return handleSaveRelancesConfig(req, data, res);
    case "fill-cerfa":
      return handleFillCerfa(req, data, res);
    case "generate-facture":
      return handleGenerateFacture(req, data, res);
    case "send-facture-email":
      return handleSendFactureEmail(req, data, res);
    case "lookup-invitation":
      return handleLookupInvitation(data, res);
    case "invite-membre":
      return handleInviteMembre(req, data, res);
    case "accept-invitation":
      return handleAcceptInvitation(req, data, res);
    case "agent-post-vente":
      return handleAgentPostVente(req, data, res);
    case "export-livre-police":
      return handleExportLivrePolice(req, data, res);
    case "estimer-reprise":
      return handleEstimerReprise(req, data, res);
    case "send-welcome-email":
      return handleSendWelcomeEmail(data, res);
    default:
      return res.status(400).json({ error: "Action inconnue" });
  }
}

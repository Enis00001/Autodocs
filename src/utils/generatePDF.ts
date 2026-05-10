import type { BonDraftData } from "@/utils/drafts";

export function downloadBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type SendPdfEmailPayload = {
  pdfBase64: string;
  clientEmail: string;
  clientNom: string;
  clientPrenom: string;
  vehiculeModele: string;
  vendeurNom: string;
  /** Email du vendeur (pour la confirmation de signature client). */
  vendeurEmail?: string;
  /** ID du brouillon — permet de relier la `signature_request` au brouillon. */
  brouillonId?: string;
  /** Données du formulaire (sérialisables) pour permettre au lien de signature
   *  publique de re-rendre le PDF avec les deux signatures. */
  formData?: Record<string, string>;
  /** Signature vendeur déjà capturée (base64 PNG). */
  signatureVendeurBase64?: string;
};

export type SendPdfEmailResult = {
  ok: true;
  signatureRequest?: {
    token: string;
    signUrl: string;
    expiresAt: string;
  };
};

export function buildPdfFormDataFromDraft(draft: BonDraftData): Record<string, string> {
  return {
    clientNom: draft.clientNom ?? "",
    clientPrenom: draft.clientPrenom ?? "",
    clientDateNaissance: draft.clientDateNaissance ?? "",
    clientNumeroCni: draft.clientNumeroCni ?? "",
    clientAdresse: "",
    clientEmail: "",
    stock_donnees: JSON.stringify(draft.stockDonnees ?? {}),
    stock_colonnes: JSON.stringify(draft.stockColonnes ?? []),
    repriseActive: draft.repriseActive ? "oui" : "non",
    reprise_plaque: draft.reprisePlaque ?? "",
    reprise_marque: draft.repriseMarque ?? "",
    reprise_modele: draft.repriseModele ?? "",
    reprise_vin: draft.repriseVin ?? "",
    reprise_premiere_circulation: draft.reprisePremiereCirculation ?? "",
    reprise_valeur: draft.repriseValeur ?? "",
    reprise_duree_mois: draft.repriseDureeMois ?? "",
    vehiculePrix: draft.vehiculePrix ?? "",
    modePaiement: draft.modePaiement ?? "comptant",
    acompte: draft.acompte ?? "",
    vehiculeRemise: draft.vehiculeRemise ?? "",
    vehiculeDateLivraison: draft.vehiculeDateLivraison ?? "",
    custom_fields_values: JSON.stringify(draft.customFieldsValues ?? {}),
    custom_fields_defs: "[]",
  };
}

type GeneratePdfOptions = {
  /**
   * Si `true`, déclenche le téléchargement automatique du PDF dans le
   * navigateur (comportement historique). Mettre à `false` pour orchestrer
   * un flow de signature avant le téléchargement final.
   * @default true
   */
  download?: boolean;
};

/**
 * Génère un bon de commande PDF via le template HTML côté serveur.
 * Envoie toutes les données du formulaire (standard + custom) à /api/generate-pdf
 * qui remplace les placeholders dans le template HTML puis convertit en PDF.
 */
export async function generatePDF(
  formData: Record<string, string>,
  options: GeneratePdfOptions = {},
) {
  const { download = true } = options;
  const nonEmpty = Object.entries(formData).filter(([, v]) => v.trim() !== "");
  console.log(`[generatePDF] Envoi de ${nonEmpty.length} champs à /api/generate-pdf`);

  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/generate-pdf", {
    method: "POST",
    body: JSON.stringify({ formData }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      bonsTotal?: number;
      quota?: number;
      plan?: string;
    };
    console.error("[generatePDF] Erreur:", errBody);
    if (response.status === 429 || errBody?.code === "quota_reached") {
      const err = new Error("Limite atteinte.") as Error & {
        code?: string;
        info?: { bonsTotal?: number; quota?: number; plan?: string };
      };
      err.code = "quota_reached";
      err.info = {
        bonsTotal: errBody.bonsTotal,
        quota: errBody.quota,
        plan: errBody.plan,
      };
      throw err;
    }
    throw new Error(
      errBody?.error || `Erreur génération PDF (${response.status})`,
    );
  }

  const json = (await response.json()) as { pdfBase64?: string };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur PDF.");
  }

  const fileName = `bon-de-commande-${new Date().toISOString().slice(0, 10)}.pdf`;
  if (download) {
    downloadBase64Pdf(json.pdfBase64, fileName);
  }

  return {
    pdfBase64: json.pdfBase64,
    fileName,
  };
}

/**
 * Intègre une signature (vendeur et/ou client) dans le PDF en re-rendant le
 * HTML serveur-side avec les zones {{signature_vendeur}} / {{signature_client}}
 * remplacées par des balises <img>. Renvoie le PDF résultant en base64.
 */
export async function embedSignatureInPdf(payload: {
  formData: Record<string, string>;
  signatureVendeurBase64?: string;
  signatureClientBase64?: string;
}): Promise<{ pdfBase64: string }> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "embed-signature",
      ...payload,
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(
      errBody?.error || `Erreur intégration signature (${response.status})`,
    );
  }

  const json = (await response.json()) as { pdfBase64?: string };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur signature.");
  }
  return { pdfBase64: json.pdfBase64 };
}

/**
 * Re-envoie l'email contenant le lien de signature pour un brouillon donné.
 * Réutilise le token existant si la signature_request n'est pas expirée,
 * sinon en crée une nouvelle (avec le PDF déjà persisté).
 */
export async function resendSignatureEmail(payload: {
  brouillonId?: string;
  token?: string;
}): Promise<{ ok: true; token: string; signUrl: string; expiresAt: string }> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "resend-signature-email",
      ...payload,
    }),
  });
  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody?.error || `Erreur renvoi du lien (${response.status})`);
  }
  return (await response.json()) as {
    ok: true;
    token: string;
    signUrl: string;
    expiresAt: string;
  };
}

export async function sendPdfByEmail(payload: SendPdfEmailPayload): Promise<SendPdfEmailResult> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "send-email",
      ...payload,
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody?.error || `Erreur envoi email (${response.status})`);
  }

  const json = (await response.json().catch(() => ({}))) as {
    signatureRequest?: { token: string; signUrl: string; expiresAt: string };
  };
  return { ok: true, signatureRequest: json.signatureRequest };
}

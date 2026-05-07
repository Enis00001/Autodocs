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
};

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
 * Intègre une signature client (PNG en base64) dans un PDF généré.
 * Renvoie le PDF modifié encodé en base64.
 */
export async function embedSignatureInPdf(payload: {
  pdfBase64: string;
  signatureBase64: string;
}): Promise<{ pdfBase64: string }> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/embed-signature", {
    method: "POST",
    body: JSON.stringify(payload),
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

export async function sendPdfByEmail(payload: SendPdfEmailPayload): Promise<void> {
  const { apiFetch } = await import("@/lib/apiClient");
  const response = await apiFetch("/api/send-pdf-email", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody?.error || `Erreur envoi email (${response.status})`);
  }
}

function downloadBase64Pdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Génère un bon de commande PDF via le template HTML côté serveur.
 * Envoie toutes les données du formulaire (standard + custom) à /api/generate-pdf
 * qui remplace les placeholders dans le template HTML puis convertit en PDF.
 */
export async function generatePDF(
  formData: Record<string, string>,
  _templateId?: string,
) {
  const nonEmpty = Object.entries(formData).filter(([, v]) => v.trim() !== "");
  console.log(`[generatePDF] Envoi de ${nonEmpty.length} champs à /api/generate-pdf`);

  const response = await fetch("/api/generate-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formData }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    console.error("[generatePDF] Erreur:", errBody);
    throw new Error(
      errBody?.error || `Erreur génération PDF (${response.status})`,
    );
  }

  const json = (await response.json()) as { pdfBase64?: string };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur PDF.");
  }

  const fileName = `bon-de-commande-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBase64Pdf(json.pdfBase64, fileName);
}

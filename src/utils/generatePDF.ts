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
 * Appelle /api/fill-pdf avec le templateId (pdf_templates.id) et les
 * données du formulaire, puis télécharge le PDF rempli.
 */
export async function generatePDF(
  formData: Record<string, string>,
  templateId: string
) {
  if (!templateId) {
    throw new Error("Aucun template sélectionné.");
  }
  console.log("[generatePDF] payload envoyé à /api/fill-pdf:", {
    templateId,
    formData,
  });

  const response = await fetch("/api/fill-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, formData }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(
      errBody?.error || `Erreur génération PDF (${response.status})`
    );
  }

  const json = (await response.json()) as { pdfBase64: string };
  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur PDF.");
  }

  const fileName = `bon-de-commande-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBase64Pdf(json.pdfBase64, fileName);
}

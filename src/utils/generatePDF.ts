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

  // #region agent log — H2,H3: formData envoyé
  const nonEmptyKeys = Object.entries(formData).filter(([,v]) => v.trim() !== "").map(([k,v]) => [k, v.slice(0, 80)]);
  const emptyKeys = Object.keys(formData).filter(k => formData[k].trim() === "");
  const _dbgSend = {templateId,nonEmptyFields:Object.fromEntries(nonEmptyKeys),emptyFieldCount:emptyKeys.length,emptyFieldNames:emptyKeys,totalFields:Object.keys(formData).length};
  console.log('%c[DEBUG d51c4f] formData ENVOYÉ à fill-pdf','color:cyan;font-weight:bold', _dbgSend);
  fetch('http://127.0.0.1:7340/ingest/040176fc-875f-4473-8368-07f3b5d8ca7d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d51c4f'},body:JSON.stringify({sessionId:'d51c4f',runId:'run1',hypothesisId:'H2_H3',location:'generatePDF.ts:BEFORE_FETCH',message:'formData envoyé à fill-pdf',data:_dbgSend,timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  const response = await fetch("/api/fill-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateId, formData }),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    // #region agent log — error response
    console.error('%c[DEBUG d51c4f] fill-pdf ERREUR','color:red;font-weight:bold', {status:response.status,errBody});
    fetch('http://127.0.0.1:7340/ingest/040176fc-875f-4473-8368-07f3b5d8ca7d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d51c4f'},body:JSON.stringify({sessionId:'d51c4f',runId:'run1',hypothesisId:'H_ERROR',location:'generatePDF.ts:ERROR',message:'fill-pdf returned error',data:{status:response.status,errBody},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    throw new Error(
      errBody?.error || `Erreur génération PDF (${response.status})`
    );
  }

  const json = (await response.json()) as { pdfBase64: string; mapping?: Record<string, string>; debug?: { field_mapping?: Record<string, string>; matches?: Array<{ pdfFieldName: string; standardKey: string | null; value: string }>; formData?: Record<string, unknown> }; stats?: { filledCount?: number; skippedCount?: number; fallbackCount?: number } };

  // #region agent log — H1,H4,H5: server response debug
  const dbg = json.debug;
  const mappingEntries = dbg?.field_mapping ? Object.entries(dbg.field_mapping) : [];
  const matchesWithValue = (dbg?.matches ?? []).filter(m => m.value && m.value.trim() !== "");
  const matchesWithoutValue = (dbg?.matches ?? []).filter(m => !m.value || m.value.trim() === "");
  const _dbgResp = {fieldMappingCount:mappingEntries.length,fieldMappingRaw:Object.fromEntries(mappingEntries.slice(0,30)),resolvedMapping:json.mapping ? Object.fromEntries(Object.entries(json.mapping).slice(0,30)) : null,matchesFilledCount:matchesWithValue.length,matchesSkippedCount:matchesWithoutValue.length,matchesFilled:matchesWithValue.slice(0,30),matchesSkipped:matchesWithoutValue.slice(0,30)};
  console.log('%c[DEBUG d51c4f] fill-pdf RÉPONSE — field_mapping DB','color:lime;font-weight:bold', Object.fromEntries(mappingEntries));
  console.log('%c[DEBUG d51c4f] fill-pdf RÉPONSE — resolvedMapping utilisé','color:lime;font-weight:bold', json.mapping);
  console.log('%c[DEBUG d51c4f] fill-pdf RÉPONSE — matches REMPLIS','color:lime;font-weight:bold', matchesWithValue);
  console.log('%c[DEBUG d51c4f] fill-pdf RÉPONSE — matches IGNORÉS (vide)','color:orange;font-weight:bold', matchesWithoutValue);
  console.log('%c[DEBUG d51c4f] RÉSUMÉ','color:yellow;font-weight:bold', `Mapping: ${mappingEntries.length} entrées | Remplis: ${matchesWithValue.length} | Ignorés: ${matchesWithoutValue.length} | Fallbacks: ${json.stats?.fallbackCount ?? '?'}`);
  fetch('http://127.0.0.1:7340/ingest/040176fc-875f-4473-8368-07f3b5d8ca7d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d51c4f'},body:JSON.stringify({sessionId:'d51c4f',runId:'run1',hypothesisId:'H1_H4_H5',location:'generatePDF.ts:AFTER_FETCH',message:'fill-pdf response debug',data:_dbgResp,timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!json?.pdfBase64) {
    throw new Error("Réponse invalide du serveur PDF.");
  }

  const fileName = `bon-de-commande-${new Date().toISOString().slice(0, 10)}.pdf`;
  downloadBase64Pdf(json.pdfBase64, fileName);
}

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Zap, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import {
  generatePDF,
  sendPdfByEmail,
  embedSignatureInPdf,
  downloadBase64Pdf,
} from "@/utils/generatePDF";
import { countMissingMandatoryFields, isDraftFormComplete } from "@/utils/bonFormCompletion";
import SignaturePad from "@/components/SignaturePad";
import { cn } from "@/lib/utils";

export { countMissingMandatoryFields, isDraftFormComplete };

type GenerateBarProps = {
  documentsUploaded: number;
  missingFieldsCount: number;
  formData: Record<string, string>;
  clientEmail?: string;
  clientNom?: string;
  clientPrenom?: string;
  vehiculeModele?: string;
  vendeurNom?: string;
  /** Email du vendeur courant — utilisé pour la confirmation de signature client. */
  vendeurEmail?: string;
  /** ID du brouillon courant (sauvegardé). Optionnel. */
  brouillonId?: string;
  /** Conservé pour compat API ; inutilisé. */
  templateId: string;
  /**
   * Callback déclenché quand le PDF a été signé (côté vendeur) avec succès.
   * Permet à la page parente de persister le brouillon avec `signed = true`
   * et de mettre à jour son state local. Reçoit la date ISO de signature.
   */
  onSigned?: (signedAt: string) => void | Promise<void>;
  /**
   * Callback optionnel déclenché après l'envoi de l'email de signature
   * (lien public envoyé au client). Reçoit le token unique.
   */
  onSignatureRequestSent?: (token: string) => void | Promise<void>;
  /**
   * Déclenché une fois lorsque le flux PDF est terminé avec succès (téléchargement
   * / signature vendeur / email optionnel). Permet à la page parente d'afficher
   * des actions rapides (CRM, marquer vendu, etc.).
   */
  onFlowSuccess?: () => void;
};

const MAX_DOTS = 6;

const GenerateBar = ({
  documentsUploaded,
  missingFieldsCount,
  formData,
  clientEmail = "",
  clientNom = "",
  clientPrenom = "",
  vehiculeModele = "Véhicule",
  vendeurNom = "Votre conseiller",
  vendeurEmail = "",
  brouillonId,
  templateId: _templateId,
  onSigned,
  onSignatureRequestSent,
  onFlowSuccess,
}: GenerateBarProps) => {
  void _templateId;
  const [modalOpen, setModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [showSignaturePrompt, setShowSignaturePrompt] = useState(false);
  const [isEmbeddingSignature, setIsEmbeddingSignature] = useState(false);
  const [isSigned, setIsSigned] = useState(false);
  const [signatureVendeurBase64, setSignatureVendeurBase64] = useState<string | null>(null);
  const [signatureRequestUrl, setSignatureRequestUrl] = useState<string | null>(null);
  const [generatedPdfBase64, setGeneratedPdfBase64] = useState<string | null>(null);
  const [generatedFileName, setGeneratedFileName] = useState<string>("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<null | {
    bonsTotal: number;
    quota: number;
  }>(null);

  const flowSuccessFiredRef = useRef(false);
  useEffect(() => {
    if (isSuccess && !flowSuccessFiredRef.current) {
      flowSuccessFiredRef.current = true;
      try {
        onFlowSuccess?.();
      } catch (e) {
        console.warn("[GenerateBar] onFlowSuccess:", e);
      }
    }
    if (!isSuccess) flowSuccessFiredRef.current = false;
  }, [isSuccess, onFlowSuccess]);

  const canGenerate = documentsUploaded > 0 || missingFieldsCount < 5;

  const resetState = () => {
    setIsGenerating(false);
    setIsSuccess(false);
    setIsSendingEmail(false);
    setEmailSent(false);
    setShowEmailPrompt(false);
    setShowSignaturePrompt(false);
    setIsEmbeddingSignature(false);
    setIsSigned(false);
    setSignatureVendeurBase64(null);
    setSignatureRequestUrl(null);
    setGeneratedPdfBase64(null);
    setGeneratedFileName("");
    setGenerationError(null);
    setQuotaBlocked(null);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setModalOpen(true);
    resetState();
    setIsGenerating(true);
    try {
      // Le quota et l'incrément sont gérés côté serveur (api/generate-pdf.ts).
      // On désactive le téléchargement automatique : il sera déclenché soit
      // après signature, soit via le bouton « Télécharger sans signature ».
      const result = await generatePDF(formData, { download: false });
      setIsGenerating(false);
      setGeneratedPdfBase64(result.pdfBase64);
      setGeneratedFileName(result.fileName);
      setShowSignaturePrompt(true);
    } catch (err) {
      const e = err as Error & {
        code?: string;
        info?: { bonsTotal?: number; quota?: number };
      };
      setIsGenerating(false);
      setIsSuccess(false);
      if (e.code === "quota_reached") {
        setQuotaBlocked({
          bonsTotal: e.info?.bonsTotal ?? 0,
          quota: e.info?.quota ?? 10,
        });
        return;
      }
      setGenerationError(
        err instanceof Error ? err.message : "Erreur lors de la génération PDF",
      );
    }
  };

  const finalizeAfterDownload = (base64: string, fileName: string) => {
    const signedFileName = isSigned
      ? fileName.replace(/\.pdf$/i, "-signe.pdf")
      : fileName;
    downloadBase64Pdf(base64, signedFileName);
    if (clientEmail.trim()) {
      setShowEmailPrompt(true);
    } else {
      setIsSuccess(true);
    }
  };

  const handleValidateSignature = async (signatureBase64: string) => {
    if (!generatedPdfBase64) return;
    setIsEmbeddingSignature(true);
    setGenerationError(null);
    try {
      // On re-rend le PDF côté serveur en injectant la signature vendeur
      // dans la zone HTML « Cachet & signature » via {{signature_vendeur}}.
      const { pdfBase64: signedPdfBase64 } = await embedSignatureInPdf({
        formData,
        signatureVendeurBase64: signatureBase64,
      });
      const signedAt = new Date().toISOString();
      setGeneratedPdfBase64(signedPdfBase64);
      setSignatureVendeurBase64(signatureBase64);
      setIsSigned(true);
      setShowSignaturePrompt(false);
      setIsEmbeddingSignature(false);

      const signedFileName = generatedFileName.replace(/\.pdf$/i, "-signe.pdf");
      downloadBase64Pdf(signedPdfBase64, signedFileName);

      try {
        await onSigned?.(signedAt);
      } catch (err) {
        console.warn("[GenerateBar] onSigned a échoué:", err);
      }

      if (clientEmail.trim()) {
        setShowEmailPrompt(true);
      } else {
        setIsSuccess(true);
      }
    } catch (err) {
      setIsEmbeddingSignature(false);
      setGenerationError(
        err instanceof Error ? err.message : "Erreur lors de l'intégration de la signature",
      );
    }
  };

  const handleSkipSignature = () => {
    if (!generatedPdfBase64) return;
    setShowSignaturePrompt(false);
    finalizeAfterDownload(generatedPdfBase64, generatedFileName);
  };

  const handleSendEmail = async () => {
    if (!generatedPdfBase64 || !clientEmail.trim()) return;
    setIsSendingEmail(true);
    setGenerationError(null);
    try {
      const result = await sendPdfByEmail({
        pdfBase64: generatedPdfBase64,
        clientEmail: clientEmail.trim(),
        clientNom: clientNom.trim(),
        clientPrenom: clientPrenom.trim(),
        vehiculeModele: vehiculeModele.trim() || "Véhicule",
        vendeurNom: vendeurNom.trim() || "Votre conseiller",
        vendeurEmail: vendeurEmail.trim() || undefined,
        brouillonId,
        formData,
        signatureVendeurBase64: signatureVendeurBase64 ?? undefined,
      });
      setIsSendingEmail(false);
      setShowEmailPrompt(false);
      setEmailSent(true);
      setIsSuccess(true);
      if (result.signatureRequest?.signUrl) {
        setSignatureRequestUrl(result.signatureRequest.signUrl);
        try {
          await onSignatureRequestSent?.(result.signatureRequest.token);
        } catch (err) {
          console.warn("[GenerateBar] onSignatureRequestSent a échoué:", err);
        }
      }
    } catch (err) {
      setIsSendingEmail(false);
      setGenerationError(err instanceof Error ? err.message : "Erreur lors de l'envoi de l'email");
    }
  };

  const filledDots = Math.min(documentsUploaded, MAX_DOTS);

  const lockClose = isGenerating || isSendingEmail || isEmbeddingSignature;

  return (
    <>
      <div
        className={cn(
          "z-40 border-t border-border/60 bg-card/95 shadow-[0_-8px_32px_rgba(0,0,0,0.28)] backdrop-blur-md md:rounded-card md:border md:shadow-card",
          "fixed bottom-0 left-0 right-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:z-auto md:border-0 md:bg-card md:p-0 md:pb-0 md:shadow-card",
        )}
      >
        <div className="card-autodocs relative mx-auto flex max-w-[1500px] flex-col gap-3 overflow-hidden p-3 md:flex-row md:items-center md:justify-between md:gap-4 md:p-5">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: "linear-gradient(90deg, rgba(99, 102, 241, 0.06) 0%, transparent 50%)",
            }}
          />
          <div className="relative z-10 flex items-center gap-3">
            <div className="hidden items-center gap-1 md:flex">
              {Array.from({ length: MAX_DOTS }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full transition-colors duration-200",
                    i < filledDots ? "bg-success" : "bg-border",
                  )}
                />
              ))}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-foreground">
                <span className="font-semibold">
                  {documentsUploaded} doc{documentsUploaded !== 1 ? "s" : ""}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {missingFieldsCount} manquant{missingFieldsCount !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="hidden text-xs text-muted-foreground md:block">
                Complétez les champs ou générez le PDF
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={!canGenerate}
            className={cn(
              "btn-primary relative z-10 w-full min-h-[48px] rounded-lg text-sm disabled:hover:translate-y-0",
              "md:w-auto",
            )}
            onClick={handleGenerate}
          >
            <FileText className="h-4 w-4" />
            Générer le bon de commande
          </button>
        </div>
      </div>

      {modalOpen && (
        <>
          <div
            className="fixed left-0 top-0 z-[9998] h-[100vh] w-[100vw] animate-in fade-in-0 duration-200"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => {
              if (!lockClose) setModalOpen(false);
            }}
          />
          <div
            className={cn(
              "fixed inset-0 z-[9999] flex animate-in fade-in-0 flex-col overflow-y-auto border border-border bg-[#1A1D27] p-5 duration-200 md:inset-auto md:left-1/2 md:top-10 md:block md:h-auto md:max-h-[calc(100vh-4rem)] md:w-[calc(100vw-2rem)] md:-translate-x-1/2 md:rounded-2xl md:p-7 md:slide-in-from-top-4",
              showSignaturePrompt ? "md:max-w-[520px]" : "md:max-w-[400px]",
            )}
            style={{
              paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-generate-title"
          >
            <h2
              id="modal-generate-title"
              className="mb-6 text-center font-display text-lg font-bold"
            >
              {quotaBlocked
                ? "Limite atteinte"
                : isGenerating
                  ? "Génération en cours..."
                  : showSignaturePrompt
                    ? "Signature du vendeur"
                    : showEmailPrompt
                      ? "Envoi par email"
                    : "Bon de commande"}
            </h2>

            {quotaBlocked && (
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <Zap className="h-6 w-6" aria-hidden />
                </div>
                <p className="text-center text-sm text-foreground">
                  Vous avez utilisé {quotaBlocked.bonsTotal} / {quotaBlocked.quota} bons
                  gratuits sur le plan Gratuit.
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  Passez au plan Pro pour générer des bons de commande illimités.
                </p>
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
                  <Link
                    to="/abonnement"
                    className="btn-primary w-full cursor-pointer sm:w-auto"
                    onClick={() => setModalOpen(false)}
                  >
                    Passer au Pro
                  </Link>
                  <button
                    type="button"
                    className="btn-secondary w-full cursor-pointer sm:w-auto"
                    onClick={() => setModalOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            )}

            {!quotaBlocked && isGenerating && (
              <div className="flex flex-col items-center gap-4 py-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">Génération en cours…</p>
              </div>
            )}

            {!quotaBlocked && !isGenerating && showSignaturePrompt && (
              <div className="flex flex-col gap-4">
                <p className="text-center text-sm text-foreground">
                  Signez ci-dessous (zone « Cachet & signature » du vendeur).
                  La signature client se fera ensuite via le lien envoyé par email.
                </p>
                {isEmbeddingSignature ? (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
                    <p className="text-sm text-muted-foreground">
                      Intégration de la signature dans le PDF…
                    </p>
                  </div>
                ) : (
                  <SignaturePad onValidate={handleValidateSignature} />
                )}
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer px-3 py-2 text-xs"
                    onClick={handleSkipSignature}
                    disabled={isEmbeddingSignature}
                  >
                    Télécharger sans signature
                  </button>
                </div>
                {generationError && (
                  <p className="text-center text-xs text-destructive">{generationError}</p>
                )}
              </div>
            )}

            {!quotaBlocked && !isGenerating && showEmailPrompt && (
              <div className="flex flex-col items-center gap-5">
                {isSigned && (
                  <div className="flex items-center gap-2 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Vendeur signé
                  </div>
                )}
                <p className="text-center text-sm text-foreground">
                  Envoyer le bon de commande {isSigned ? "signé par le vendeur " : ""}
                  par email à <strong>{clientEmail}</strong> ?
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  Un lien de signature électronique sera inclus pour permettre au
                  client de signer en ligne.
                </p>
                <div className="flex w-full justify-center gap-3">
                  <button
                    type="button"
                    className="btn-primary cursor-pointer border-0 px-4 py-2.5 text-sm"
                    onClick={handleSendEmail}
                    disabled={isSendingEmail}
                  >
                    {isSendingEmail ? "Envoi..." : "Envoyer"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer px-4 py-2.5 text-sm"
                    onClick={() => {
                      if (isSendingEmail) return;
                      setShowEmailPrompt(false);
                      setIsSuccess(true);
                    }}
                  >
                    Non merci
                  </button>
                </div>
              </div>
            )}

            {!quotaBlocked && isSuccess && !showEmailPrompt && !showSignaturePrompt && (
              <div className="flex flex-col items-center gap-5">
                {isSigned && (
                  <div className="flex items-center gap-2 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Vendeur signé
                  </div>
                )}
                <p className="text-center text-sm text-foreground">
                  {emailSent
                    ? "Email envoyé ✅"
                    : isSigned
                      ? "Bon de commande signé téléchargé."
                      : "Bon de commande généré avec succès"}
                </p>
                {emailSent && signatureRequestUrl && (
                  <div className="w-full rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    <p className="mb-2 text-muted-foreground">
                      Lien de signature électronique envoyé au client :
                    </p>
                    <code className="break-all text-[11px] text-foreground/90">
                      {signatureRequestUrl}
                    </code>
                  </div>
                )}
                <div className="flex w-full justify-center gap-3">
                  <button
                    type="button"
                    className="btn-primary cursor-pointer border-0 px-4 py-2.5 text-sm"
                    onClick={() => setModalOpen(false)}
                  >
                    Terminé
                  </button>
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer px-4 py-2.5 text-sm"
                    onClick={() => setModalOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            )}

            {!quotaBlocked &&
              !isGenerating &&
              !showSignaturePrompt &&
              generationError && (
                <div className="flex flex-col items-center gap-4">
                  <p className="text-center text-sm text-destructive">{generationError}</p>
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer px-4 py-2.5 text-sm"
                    onClick={() => setModalOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
              )}
          </div>
        </>
      )}
    </>
  );
};

export default GenerateBar;

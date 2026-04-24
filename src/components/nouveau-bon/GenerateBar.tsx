import { useState } from "react";
import { FileText, Loader2, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { generatePDF } from "@/utils/generatePDF";
import { countMissingMandatoryFields, isDraftFormComplete } from "@/utils/bonFormCompletion";
import { cn } from "@/lib/utils";

export { countMissingMandatoryFields, isDraftFormComplete };

type GenerateBarProps = {
  documentsUploaded: number;
  missingFieldsCount: number;
  formData: Record<string, string>;
  /** Conservé pour compat API ; inutilisé. */
  templateId: string;
};

const MAX_DOTS = 6;

const GenerateBar = ({
  documentsUploaded,
  missingFieldsCount,
  formData,
  templateId: _templateId,
}: GenerateBarProps) => {
  void _templateId;
  const [modalOpen, setModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<null | {
    bonsCeMois: number;
    quota: number;
  }>(null);

  const canGenerate = documentsUploaded > 0 || missingFieldsCount < 5;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setModalOpen(true);
    setIsGenerating(true);
    setIsSuccess(false);
    setGenerationError(null);
    setQuotaBlocked(null);
    try {
      // Le quota et l'incrément sont gérés côté serveur (api/generate-pdf.ts).
      // Si le user a atteint la limite, l'API renvoie 429 → on remonte un
      // `code: "quota_reached"` pour afficher le bandeau d'upgrade.
      await generatePDF(formData);
      setIsGenerating(false);
      setIsSuccess(true);
    } catch (err) {
      const e = err as Error & {
        code?: string;
        info?: { bonsCeMois?: number; quota?: number };
      };
      setIsGenerating(false);
      setIsSuccess(false);
      if (e.code === "quota_reached") {
        setQuotaBlocked({
          bonsCeMois: e.info?.bonsCeMois ?? 0,
          quota: e.info?.quota ?? 10,
        });
        return;
      }
      setGenerationError(
        err instanceof Error ? err.message : "Erreur lors de la génération PDF",
      );
    }
  };

  const filledDots = Math.min(documentsUploaded, MAX_DOTS);

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
              if (!isGenerating) setModalOpen(false);
            }}
          />
          <div
            className="fixed inset-0 z-[9999] flex animate-in fade-in-0 flex-col overflow-y-auto border border-border bg-[#1A1D27] p-5 duration-200 md:inset-auto md:left-1/2 md:top-10 md:block md:h-auto md:max-h-[calc(100vh-4rem)] md:w-[calc(100vw-2rem)] md:max-w-[400px] md:-translate-x-1/2 md:rounded-2xl md:p-7 md:slide-in-from-top-4"
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
                  : "Bon de commande"}
            </h2>

            {quotaBlocked && (
              <div className="flex flex-col items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
                  <Zap className="h-6 w-6" aria-hidden />
                </div>
                <p className="text-center text-sm text-foreground">
                  Vous avez utilisé {quotaBlocked.bonsCeMois} / {quotaBlocked.quota} bons ce
                  mois sur le plan Gratuit.
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

            {!quotaBlocked && isSuccess && (
              <div className="flex flex-col items-center gap-5">
                <p className="text-center text-sm text-foreground">Bon de commande généré avec succès</p>
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

            {!quotaBlocked && !isGenerating && generationError && (
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

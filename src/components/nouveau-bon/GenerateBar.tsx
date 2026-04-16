import { useState } from "react";
import { Zap, Loader2 } from "lucide-react";
import { generatePDF } from "@/utils/generatePDF";

const MANDATORY_FIELDS = [
  "clientNom",
  "clientPrenom",
  "clientAdresse",
  "vehiculeModele",
  "vehiculePrix",
] as const;

export function countMissingMandatoryFields(form: Record<string, unknown>): number {
  return MANDATORY_FIELDS.filter((key) => !String(form[key] ?? "").trim()).length;
}

type GenerateBarProps = {
  documentsUploaded: number;
  missingFieldsCount: number;
  /** Données complètes du formulaire à injecter dans le PDF. */
  formData: Record<string, string>;
  /** ID du template PDF (pdf_templates.id). */
  templateId: string;
};

const MAX_DOTS = 6;

const GenerateBar = ({ documentsUploaded, missingFieldsCount, formData, templateId }: GenerateBarProps) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const canGenerate = documentsUploaded > 0 || missingFieldsCount < 5;

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setModalOpen(true);
    setIsGenerating(true);
    setIsSuccess(false);
    setGenerationError(null);
    try {
      await generatePDF(formData);
      setIsGenerating(false);
      setIsSuccess(true);
    } catch (err) {
      setIsGenerating(false);
      setIsSuccess(false);
      setGenerationError(err instanceof Error ? err.message : "Erreur lors de la génération PDF");
    }
  };

  const filledDots = Math.min(documentsUploaded, MAX_DOTS);

  return (
    <>
      <div className="card-autodocs col-span-2 flex items-center justify-between relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, hsla(228,91%,64%,0.05) 0%, transparent 50%)",
          }}
        />

        <div className="flex items-center gap-3 relative z-10">
          <div className="flex gap-1 items-center">
            {Array.from({ length: MAX_DOTS }, (_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${
                  i < filledDots ? "bg-success" : "bg-border"
                }`}
              />
            ))}
          </div>
          <div>
            <div className="text-[13px]">
              <strong className="font-semibold">
                {documentsUploaded} document{documentsUploaded !== 1 ? "s" : ""} importé
                {documentsUploaded !== 1 ? "s" : ""}
              </strong>{" "}
              · {missingFieldsCount} champ{missingFieldsCount !== 1 ? "s" : ""} manquant
              {missingFieldsCount !== 1 ? "s" : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              Vous pouvez générer le bon ou compléter les champs manquants
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!canGenerate}
          className="relative z-10 gradient-primary px-6 py-3 rounded-[9px] font-display text-sm font-bold text-primary-foreground transition-all duration-200 flex items-center gap-2 border-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 cursor-pointer hover:-translate-y-0.5"
          style={{ boxShadow: "0 4px 20px hsla(228,91%,64%,0.3)" }}
          onMouseEnter={(e) => {
            if (canGenerate)
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 8px 28px hsla(228,91%,64%,0.45)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.boxShadow =
              "0 4px 20px hsla(228,91%,64%,0.3)";
          }}
          onClick={handleGenerate}
        >
          <Zap className="w-4 h-4" />
          Générer le bon de commande
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => {
            if (!isGenerating) setModalOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-generate-title"
        >
          <div
            className="w-full max-w-[400px] animate-in fade-in-0 slide-in-from-bottom-4 duration-200"
            style={{
              borderRadius: 16,
              background: "#111118",
              border: "1px solid #2a2a35",
              padding: 28,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="modal-generate-title"
              className="font-display font-bold text-center mb-6"
              style={{ fontSize: 18 }}
            >
              {isGenerating ? "Génération en cours..." : "Bon de commande"}
            </h2>

            {isGenerating && (
              <div className="flex flex-col items-center gap-4 py-4">
                <Loader2
                  className="w-12 h-12 text-primary animate-spin"
                  aria-hidden
                />
                <p className="text-sm text-muted-foreground">
                  Génération en cours...
                </p>
              </div>
            )}

            {isSuccess && (
              <div className="flex flex-col items-center gap-5">
                <p className="text-sm text-foreground text-center">
                  ✓ Bon de commande généré avec succès !
                </p>
                <div className="flex gap-3 w-full justify-center">
                  <button
                    type="button"
                    className="px-4 py-2.5 rounded-lg text-sm font-medium gradient-primary text-primary-foreground cursor-pointer border-0"
                    onClick={() => setModalOpen(false)}
                  >
                    Terminé
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer bg-transparent"
                    onClick={() => setModalOpen(false)}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            )}

            {!isGenerating && generationError && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-sm text-destructive text-center">
                  ❌ {generationError}
                </p>
                <button
                  type="button"
                  className="px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer bg-transparent"
                  onClick={() => setModalOpen(false)}
                >
                  Fermer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default GenerateBar;

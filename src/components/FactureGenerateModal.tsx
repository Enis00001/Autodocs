import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Mail } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import {
  generateFacture,
  sendFactureEmail,
  type GenerateFacturePayload,
} from "@/utils/factures";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { toast } from "@/hooks/use-toast";

export type FactureModalSuccessPayload = {
  numero_facture: string;
  pdfBase64: string;
  factureId?: string;
};

export type FactureGenerateModalPreset = "standard" | "closure";

type InvoiceContactOverrides = {
  client_email?: string;
  client_telephone?: string;
  client_adresse?: string;
};

type Props = {
  open: boolean;
  draft: BonDraftData | null;
  onClose: () => void;
  onSuccess?: (data: FactureModalSuccessPayload) => void;
  preset?: FactureGenerateModalPreset;
  /** Valeurs formulaire NouveauBon (prioritaires sur le brouillon rechargé). */
  invoiceContact?: InvoiceContactOverrides | null;
};

const FactureGenerateModal = ({
  open,
  draft,
  onClose,
  onSuccess,
  preset = "standard",
  invoiceContact = null,
}: Props) => {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState(false);

  /**
   * Email résolu : priorité aux overrides (formulaire NouveauBon, valeurs
   * « live ») puis au brouillon rechargé depuis la DB. Recalculé à chaque
   * ouverture pour refléter les éventuelles modifications.
   */
  const resolvedEmail = useMemo(() => {
    const ov = invoiceContact ?? {};
    return (
      (ov.client_email?.trim() || "") ||
      (draft?.clientEmail?.trim() || "")
    );
  }, [draft, invoiceContact]);

  useEffect(() => {
    if (!open || !draft) return;
    setNotes("");
    setError(null);
    setSendEmail(Boolean(resolvedEmail));
  }, [open, draft, resolvedEmail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !draft) return null;

  const isClosure = preset === "closure";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const ov = invoiceContact ?? {};
    const email =
      ov.client_email?.trim() ||
      draft.clientEmail?.trim() ||
      "";
    const telephone =
      ov.client_telephone?.trim() ||
      draft.clientTelephone?.trim() ||
      "";
    const adresse =
      ov.client_adresse?.trim() ||
      draft.clientAdresse?.trim() ||
      "";

    const payload: GenerateFacturePayload = {
      brouillon_id: draft.id,
      client_email: email || undefined,
      client_telephone: telephone || undefined,
      client_adresse: adresse || undefined,
      notes: notes.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const result = await generateFacture(payload);
      if (!result.ok || !result.pdfBase64) {
        setError(result.error ?? "Échec de la génération.");
        return;
      }
      downloadBase64Pdf(
        result.pdfBase64,
        `facture-${result.numero_facture ?? "autodocs"}.pdf`,
      );
      toast({
        title: result.duplicate ? "Facture existante" : "Facture générée",
        description: result.duplicate
          ? `La facture ${result.numero_facture ?? ""} existe déjà — PDF téléchargé.`
          : `Facture ${result.numero_facture ?? ""} enregistrée.`,
      });

      // Envoi email post-génération si l'utilisateur l'a coché ET qu'on a
      // un email + un factureId (pdf déjà fourni → évite une lecture DB
      // côté serveur).
      if (sendEmail && email && result.factureId) {
        try {
          const emailRes = await sendFactureEmail({
            facture_id: result.factureId,
            client_email: email,
            client_nom: draft.clientNom?.trim() || "",
            client_prenom: draft.clientPrenom?.trim() || "",
            numero_facture: result.numero_facture ?? "",
            pdf_base64: result.pdfBase64,
          });
          if (emailRes.ok) {
            toast({ title: "Facture envoyée ✓", description: `Email envoyé à ${email}.` });
          } else {
            toast({
              title: "Envoi email échoué",
              description: emailRes.error ?? "L'email n'a pas pu être envoyé.",
              variant: "destructive",
            });
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Échec de l'envoi par email.";
          toast({ title: "Envoi email échoué", description: message, variant: "destructive" });
        }
      }

      onSuccess?.({
        numero_facture: result.numero_facture ?? "",
        pdfBase64: result.pdfBase64,
        factureId: result.factureId,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel =
    preset === "closure" ? "Générer la facture" : "Générer la facture";

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div className="relative z-[10003] max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-foreground">
              Générer la facture
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {isClosure
                ? "Les données client et véhicule proviennent du bon. Ajoutez des notes si besoin."
                : "Données client et véhicule issues du brouillon. Notes facultatives."}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted cursor-pointer"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form className="space-y-4" onSubmit={(ev) => void handleSubmit(ev)}>
          <div className="flex flex-col gap-1.5">
            <label className="field-label" htmlFor="fact-notes">
              Notes complémentaires{" "}
              <span className="font-normal text-muted-foreground">(optionnel)</span>
            </label>
            <textarea
              id="fact-notes"
              className="field-input min-h-[100px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informations pour le bas de facture…"
            />
          </div>

          <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/30 p-3">
            <label className="flex items-start gap-2.5 text-[13px] font-medium text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                disabled={!resolvedEmail || submitting}
              />
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Envoyer la facture par email au client
                </span>
                <span className="text-[12px] font-normal text-muted-foreground">
                  {resolvedEmail
                    ? <>L'email sera envoyé à <strong className="text-foreground/90">{resolvedEmail}</strong>.</>
                    : "Aucun email client renseigné — case désactivée."}
                </span>
              </span>
            </label>
          </div>

          {error ? (
            <p className="text-[13px] font-medium text-destructive">{error}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary cursor-pointer"
              onClick={onClose}
              disabled={submitting}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="cursor-pointer px-4 py-2.5 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground border-0 inline-flex items-center gap-2 disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FactureGenerateModal;

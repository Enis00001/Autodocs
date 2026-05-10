import { useEffect, useState } from "react";
import { Plus, Trash2, X, Loader2 } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { generateFacture, type GenerateFacturePayload } from "@/utils/factures";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { toast } from "@/hooks/use-toast";

type PrestationLine = { libelle: string; prix_ht: string };

function draftDateToInput(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (fr)
    return `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}`;
  return "";
}

function parseEuro(raw: string): number {
  const n = parseFloat(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

type Props = {
  open: boolean;
  draft: BonDraftData | null;
  onClose: () => void;
  onSuccess?: () => void;
};

const FactureGenerateModal = ({ open, draft, onClose, onSuccess }: Props) => {
  const [dateLivraison, setDateLivraison] = useState("");
  const [acompte, setAcompte] = useState("");
  const [repriseMontant, setRepriseMontant] = useState("");
  const [repriseDesc, setRepriseDesc] = useState("");
  const [garantieActive, setGarantieActive] = useState(false);
  const [garantieMois, setGarantieMois] = useState("12");
  const [kmNonGaranti, setKmNonGaranti] = useState(false);
  const [notes, setNotes] = useState("");
  const [prestations, setPrestations] = useState<PrestationLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setDateLivraison(draftDateToInput(draft.vehiculeDateLivraison ?? ""));
    setAcompte(String(draft.acompte ?? "").trim());
    setRepriseMontant(String(draft.repriseValeur ?? "").trim());
    setRepriseDesc("");
    setGarantieActive(false);
    setGarantieMois("12");
    setKmNonGaranti(false);
    setNotes("");
    setPrestations([]);
    setError(null);
  }, [open, draft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !draft) return null;

  const addPrestation = () =>
    setPrestations((p) => [...p, { libelle: "", prix_ht: "" }]);

  const removePrestation = (i: number) =>
    setPrestations((p) => p.filter((_, idx) => idx !== i));

  const updatePrestation = (
    i: number,
    field: keyof PrestationLine,
    value: string,
  ) =>
    setPrestations((p) =>
      p.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)),
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const prestPayload: { libelle: string; prix_ht: number }[] = [];
    for (const row of prestations) {
      const lib = row.libelle.trim();
      const ht = parseEuro(row.prix_ht);
      if (!lib && ht <= 0) continue;
      if (!lib || ht <= 0) {
        setError("Chaque prestation doit avoir un libellé et un prix HT valide.");
        return;
      }
      prestPayload.push({ libelle: lib, prix_ht: ht });
    }

    const payload: GenerateFacturePayload = {
      brouillon_id: draft.id,
      date_livraison: dateLivraison.trim() || undefined,
      acompte: parseEuro(acompte),
      reprise_montant: parseEuro(repriseMontant),
      reprise_vehicule_description: repriseDesc.trim() || undefined,
      garantie_commerciale_active: garantieActive,
      garantie_commerciale_mois: garantieActive ? parseInt(garantieMois, 10) || 0 : 0,
      kilometrage_non_garanti: kmNonGaranti,
      prestations_supplementaires:
        prestPayload.length > 0 ? prestPayload : undefined,
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
      onSuccess?.();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div className="relative z-[81] max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-foreground">
              Générer la facture
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Bon signé — vérifiez les montants avant validation. Les données
              véhicule proviennent du brouillon.
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="fact-date-liv">
                Date de livraison
              </label>
              <input
                id="fact-date-liv"
                type="date"
                className="field-input cursor-pointer"
                value={dateLivraison}
                onChange={(e) => setDateLivraison(e.target.value)}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="fact-acompte">
                Acompte versé (€)
              </label>
              <input
                id="fact-acompte"
                type="text"
                inputMode="decimal"
                className="field-input"
                value={acompte}
                onChange={(e) => setAcompte(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="field-label" htmlFor="fact-reprise">
                Reprise déduite — montant (€)
              </label>
              <input
                id="fact-reprise"
                type="text"
                inputMode="decimal"
                className="field-input"
                value={repriseMontant}
                onChange={(e) => setRepriseMontant(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="field-label" htmlFor="fact-reprise-desc">
                Reprise — description (optionnel)
              </label>
              <input
                id="fact-reprise-desc"
                type="text"
                className="field-input"
                value={repriseDesc}
                onChange={(e) => setRepriseDesc(e.target.value)}
                placeholder="Ex. Renault Clio — plaque AB-123-CD"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/80 bg-muted/20 p-3 space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
              <input
                type="checkbox"
                checked={garantieActive}
                onChange={(e) => setGarantieActive(e.target.checked)}
                className="rounded border-border"
              />
              Garantie commerciale (sinon « vendu en l&apos;état »)
            </label>
            {garantieActive ? (
              <div className="flex flex-col gap-1.5 pl-6">
                <label className="field-label" htmlFor="fact-gar-mois">
                  Durée (mois)
                </label>
                <input
                  id="fact-gar-mois"
                  type="number"
                  min={1}
                  className="field-input max-w-[120px]"
                  value={garantieMois}
                  onChange={(e) => setGarantieMois(e.target.value)}
                />
              </div>
            ) : null}
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              checked={kmNonGaranti}
              onChange={(e) => setKmNonGaranti(e.target.checked)}
              className="rounded border-border"
            />
            Kilométrage non garanti (mention sur la facture)
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="field-label">Prestations supplémentaires (HT)</span>
              <button
                type="button"
                className="btn-secondary cursor-pointer gap-1 px-2 py-1 text-xs"
                onClick={addPrestation}
              >
                <Plus className="h-3.5 w-3.5" />
                Ajouter
              </button>
            </div>
            {prestations.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">Aucune prestation.</p>
            ) : (
              <div className="space-y-2">
                {prestations.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      className="field-input flex-1"
                      placeholder="Libellé"
                      value={row.libelle}
                      onChange={(e) =>
                        updatePrestation(i, "libelle", e.target.value)
                      }
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      className="field-input w-[100px]"
                      placeholder="HT"
                      value={row.prix_ht}
                      onChange={(e) =>
                        updatePrestation(i, "prix_ht", e.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="btn-danger shrink-0 px-2 cursor-pointer"
                      onClick={() => removePrestation(i)}
                      aria-label="Supprimer la ligne"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="field-label" htmlFor="fact-notes">
              Notes (bas de facture)
            </label>
            <textarea
              id="fact-notes"
              className="field-input min-h-[72px] resize-y"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Informations complémentaires…"
            />
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
              Générer le PDF
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FactureGenerateModal;

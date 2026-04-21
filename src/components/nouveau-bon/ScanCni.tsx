import { useEffect, useRef, useState } from "react";
import { IdCard } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { analyzeDocument } from "@/utils/analyzeDocument";
import type { BonDraftData, DocumentScannedState } from "@/utils/drafts";

type CniStatus = "missing" | "pending" | "ok" | "invalid" | "unreadable";

type ScanCniProps = {
  initialScan?: DocumentScannedState;
  onScannedChange?: (state: DocumentScannedState | null) => void;
  onExtracted: (
    patch: Partial<BonDraftData>,
    highlightedFields: Array<keyof BonDraftData>,
  ) => void;
};

function mapCniExtractedToForm(
  extracted: Record<string, string>,
): { patch: Partial<BonDraftData>; fields: Array<keyof BonDraftData> } {
  const patch: Partial<BonDraftData> = {};
  const fields: Array<keyof BonDraftData> = [];

  if (extracted.nom) {
    patch.clientNom = extracted.nom;
    fields.push("clientNom");
  }
  if (extracted.prenom) {
    patch.clientPrenom = extracted.prenom;
    fields.push("clientPrenom");
  }
  if (extracted.date_naissance) {
    patch.clientDateNaissance = extracted.date_naissance;
    fields.push("clientDateNaissance");
  }
  if (extracted.numero_cni) {
    patch.clientNumeroCni = extracted.numero_cni;
    fields.push("clientNumeroCni");
  }
  if (extracted.adresse) {
    patch.clientAdresse = extracted.adresse;
    fields.push("clientAdresse");
  }

  return { patch, fields };
}

function mergeExtracted(
  base: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const next = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value === "string" && value.trim()) next[key] = value;
  }
  return next;
}

const statusDotClass = (status: CniStatus) => {
  if (status === "ok") return "bg-success";
  if (status === "pending") return "bg-warning animate-pulse";
  if (status === "invalid") return "bg-warning";
  if (status === "unreadable") return "bg-destructive";
  return "bg-muted-foreground";
};

const detailTextClass = (status: CniStatus) => {
  if (status === "invalid") return "text-warning";
  if (status === "unreadable") return "text-destructive";
  if (status === "ok") return "text-success";
  return "text-muted-foreground";
};

const ScanCni = ({ initialScan, onScannedChange, onExtracted }: ScanCniProps) => {
  const [status, setStatus] = useState<CniStatus>(() => {
    if (initialScan?.status === "ok") return "ok";
    if (initialScan?.status === "invalid") return "invalid";
    if (initialScan?.status === "unreadable") return "unreadable";
    return "missing";
  });
  const [detail, setDetail] = useState<string>(initialScan?.detail ?? "Recto et verso requis");

  const [modalOpen, setModalOpen] = useState(false);
  const [rectoFile, setRectoFile] = useState<File | null>(null);
  const [versoFile, setVersoFile] = useState<File | null>(null);
  const [rectoPreview, setRectoPreview] = useState<string | null>(null);
  const [versoPreview, setVersoPreview] = useState<string | null>(null);

  const rectoImportRef = useRef<HTMLInputElement | null>(null);
  const rectoCameraRef = useRef<HTMLInputElement | null>(null);
  const versoImportRef = useRef<HTMLInputElement | null>(null);
  const versoCameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (rectoPreview) URL.revokeObjectURL(rectoPreview);
      if (versoPreview) URL.revokeObjectURL(versoPreview);
    };
  }, [rectoPreview, versoPreview]);

  const updateStatus = (next: CniStatus, nextDetail: string, extractedData?: Record<string, string>) => {
    setStatus(next);
    setDetail(nextDetail);
    if (next === "ok" || next === "invalid" || next === "unreadable") {
      onScannedChange?.({ status: next, detail: nextDetail, extractedData });
    } else {
      onScannedChange?.(null);
    }
  };

  const onSideFileSelected = (side: "recto" | "verso", file: File) => {
    if (side === "recto") {
      if (rectoPreview) URL.revokeObjectURL(rectoPreview);
      setRectoFile(file);
      setRectoPreview(URL.createObjectURL(file));
    } else {
      if (versoPreview) URL.revokeObjectURL(versoPreview);
      setVersoFile(file);
      setVersoPreview(URL.createObjectURL(file));
    }
  };

  const handleSideInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    side: "recto" | "verso",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onSideFileSelected(side, file);
    e.target.value = "";
  };

  const handleConfirm = async () => {
    if (!rectoFile || !versoFile) return;
    setModalOpen(false);
    updateStatus("pending", "⏳ Analyse recto + verso en cours...");

    const [rectoAnalysis, versoAnalysis] = await Promise.all([
      analyzeDocument(rectoFile, "cni"),
      analyzeDocument(versoFile, "cni"),
    ]);

    const mergedExtracted = mergeExtracted(
      rectoAnalysis.extractedData ?? {},
      versoAnalysis.extractedData ?? {},
    );
    const mapped = mapCniExtractedToForm(mergedExtracted);

    const rectoOk = rectoAnalysis.status === "valid" && rectoAnalysis.validation.isValid;
    const versoOk = versoAnalysis.status === "valid" && versoAnalysis.validation.isValid;

    if (rectoOk && versoOk) {
      updateStatus("ok", "✅ CNI complète (recto + verso)", mergedExtracted);
      if (Object.keys(mapped.patch).length > 0) {
        onExtracted(mapped.patch, mapped.fields);
      }
      toast({ title: "CNI analysée ✓" });
      return;
    }

    const reasons = [rectoAnalysis.validation.reason, versoAnalysis.validation.reason]
      .filter((r): r is string => Boolean(r && r.trim()))
      .join(" | ");
    const hasInvalid = rectoAnalysis.status === "invalid" || versoAnalysis.status === "invalid";
    updateStatus(
      hasInvalid ? "invalid" : "unreadable",
      `${hasInvalid ? "⚠️" : "❌"} ${reasons || (hasInvalid ? "CNI invalide" : "CNI illisible")}`,
      mergedExtracted,
    );
  };

  const openModal = (mode: "import" | "scan" = "import") => {
    setModalOpen(true);
    // Déclenche automatiquement le sélecteur approprié pour le recto.
    setTimeout(() => {
      if (mode === "scan") rectoCameraRef.current?.click();
      else rectoImportRef.current?.click();
    }, 50);
  };

  const canConfirm = Boolean(rectoFile && versoFile);

  return (
    <div className="card-autodocs">
      <div className="flex items-center justify-between mb-3">
        <span className="card-title-autodocs">🪪 Scan pièce d'identité</span>
        <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass(status)}`} />
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Scannez la carte d'identité du client (recto + verso) — les informations sont extraites
        automatiquement dans le profil client.
      </p>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-secondary/60 px-3 py-3 md:flex-row md:items-center">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-md flex items-center justify-center bg-primary/10 text-primary shrink-0">
            <IdCard className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium">
              {status === "ok" ? "Carte d'identité scannée" : "Carte d'identité (recto + verso)"}
            </div>
            <div className={`text-[11px] truncate ${detailTextClass(status)}`}>{detail}</div>
          </div>
        </div>
        <div className="flex w-full items-stretch gap-2 shrink-0 md:w-auto md:items-center">
          <button
            type="button"
            className="min-h-10 flex-1 md:flex-none px-3 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:border-primary transition-colors bg-transparent cursor-pointer whitespace-nowrap"
            onClick={() => openModal("import")}
          >
            📎 Importer
          </button>
          <button
            type="button"
            className="min-h-10 flex-1 md:flex-none px-3 py-2 rounded-md text-xs font-medium gradient-primary text-primary-foreground border-0 cursor-pointer whitespace-nowrap"
            onClick={() => openModal("scan")}
          >
            📷 Scanner
          </button>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed top-0 left-0 w-full h-full z-[9999] flex items-center justify-center p-4 animate-in fade-in-0 duration-200"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-cni-title"
        >
          <div
            className="w-full max-w-[640px] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 md:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="modal-cni-title" className="font-display text-lg font-bold mb-4">
              Carte d'identité
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(["recto", "verso"] as const).map((side) => {
                const isRecto = side === "recto";
                const preview = isRecto ? rectoPreview : versoPreview;
                return (
                  <div
                    key={side}
                    className="rounded-xl border border-border bg-secondary/40 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-bold">
                        {isRecto ? "Recto" : "Verso"}
                      </span>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          preview ? "bg-success" : "bg-muted-foreground"
                        }`}
                      />
                    </div>

                    <button
                      type="button"
                      className="w-full h-[150px] rounded-lg border border-dashed border-border bg-card hover:border-primary transition-colors flex items-center justify-center overflow-hidden cursor-pointer"
                      onClick={() =>
                        (isRecto ? rectoImportRef.current : versoImportRef.current)?.click()
                      }
                    >
                      {preview ? (
                        <img
                          src={preview}
                          alt={`Aperçu ${side}`}
                          className="h-full max-h-[150px] w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Zone de drop / upload
                        </span>
                      )}
                    </button>

                    <div className="flex gap-2">
                      <input
                        ref={isRecto ? rectoImportRef : versoImportRef}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => handleSideInput(e, side)}
                      />
                      <input
                        ref={isRecto ? rectoCameraRef : versoCameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleSideInput(e, side)}
                      />
                      <button
                        type="button"
                        className="min-h-11 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer"
                        onClick={() =>
                          (isRecto ? rectoCameraRef.current : versoCameraRef.current)?.click()
                        }
                      >
                        📷 Scanner
                      </button>
                      <button
                        type="button"
                        className="min-h-11 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer"
                        onClick={() =>
                          (isRecto ? rectoImportRef.current : versoImportRef.current)?.click()
                        }
                      >
                        📎 Importer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="min-h-11 px-4 py-2.5 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                onClick={() => setModalOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!canConfirm}
                className="min-h-11 px-4 py-2.5 rounded-lg text-sm font-medium gradient-primary text-primary-foreground border-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                onClick={handleConfirm}
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanCni;

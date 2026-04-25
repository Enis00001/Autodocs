import { useRef, useState } from "react";
import { IdCard, ScanLine } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { analyzeDocument } from "@/utils/analyzeDocument";
import type { BonDraftData, DocumentScannedState } from "@/utils/drafts";

type CniStatus = "missing" | "pending" | "ok" | "unreadable";

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

  return { patch, fields };
}

const statusDotClass = (status: CniStatus) => {
  if (status === "ok") return "bg-success";
  if (status === "pending") return "bg-warning animate-pulse";
  if (status === "unreadable") return "bg-destructive";
  return "bg-muted-foreground";
};

const detailTextClass = (status: CniStatus) => {
  if (status === "unreadable") return "text-destructive";
  if (status === "ok") return "text-success";
  return "text-muted-foreground";
};

const ScanCni = ({ initialScan, onScannedChange, onExtracted }: ScanCniProps) => {
  const [status, setStatus] = useState<CniStatus>(() => {
    if (initialScan?.status === "ok") return "ok";
    if (initialScan?.status === "unreadable") return "unreadable";
    return "missing";
  });
  const [detail, setDetail] = useState<string>(initialScan?.detail ?? "Recto requis");

  const rectoCameraRef = useRef<HTMLInputElement | null>(null);

  const updateStatus = (next: CniStatus, nextDetail: string, extractedData?: Record<string, string>) => {
    setStatus(next);
    setDetail(nextDetail);
    if (next === "ok" || next === "unreadable") {
      onScannedChange?.({ status: next, detail: nextDetail, extractedData });
    } else {
      onScannedChange?.(null);
    }
  };

  const handleRectoInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    console.log("[ScanCni] fichier recto sélectionné:", {
      hasFile: Boolean(file),
      name: file?.name,
      type: file?.type,
      size: file?.size,
    });
    if (!file) {
      console.warn("[ScanCni] aucun fichier recto récupéré depuis l'input");
      return;
    }

    updateStatus("pending", "Analyse du recto en cours...");

    const analysis = await analyzeDocument(file, "cni");
    console.log("[ScanCni] résultat analyse recto:", analysis);

    const extractedData = analysis.extractedData ?? {};
    const mapped = mapCniExtractedToForm(extractedData);

    if (Object.keys(mapped.patch).length > 0) {
      updateStatus("ok", "CNI recto analysée", extractedData);
      onExtracted(mapped.patch, mapped.fields);
      toast({ title: "CNI analysée ✓" });
      return;
    }

    updateStatus("unreadable", "Aucune information CNI lisible", extractedData);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="card-title-autodocs">Scan pièce d'identité</span>
        <span className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status)}`} />
      </div>

      <p className="text-xs text-muted-foreground">
        Recto uniquement - remplissage automatique du nom, prénom et de la date de naissance.
      </p>

      <div className="flex flex-col gap-3 rounded-input border border-border/80 bg-secondary/40 p-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-primary/15 text-primary">
            <IdCard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground">
              {status === "ok" ? "Carte d'identité scannée" : "CNI recto"}
            </div>
            <div className={`truncate text-[11px] ${detailTextClass(status)}`}>{detail}</div>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col items-stretch gap-2 md:w-auto md:flex-row md:items-center">
          <input
            ref={rectoCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleRectoInput}
          />
          <button
            type="button"
            className="btn-primary min-h-11 w-full cursor-pointer border-0 whitespace-nowrap text-sm font-semibold shadow-indigo ring-2 ring-primary/35 ring-offset-2 ring-offset-background md:order-2 md:w-auto md:text-xs"
            onClick={() => rectoCameraRef.current?.click()}
          >
            <ScanLine className="h-4 w-4 animate-pulse" />
            Scanner la CNI (recto)
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScanCni;

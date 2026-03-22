import React, { useState, useRef, useEffect } from "react";
import { Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { analyzeDocument, type DocumentKind } from "@/utils/analyzeDocument";
import type { BonDraftData } from "@/utils/drafts";

export interface DocItem {
  id: string;
  icon: string;
  name: string;
  subOption?: string;
  status: "ok" | "pending" | "missing" | "invalid" | "unreadable";
  detail: string;
}

const FINANCEMENT_OPTIONS = ["Crédit classique", "LOA", "LLD"];

function isFinancement(type: string) {
  return FINANCEMENT_OPTIONS.includes(type);
}

/** Documents obligatoires pour tous + docs supplémentaires si financement + optionnels second propriétaire */
function buildDocsList(
  vehiculeFinancement: string,
  secondProprietaire: boolean
): DocItem[] {
  const withFinancement = isFinancement(vehiculeFinancement);
  const list: DocItem[] = [
    { id: "cni", icon: "🪪", name: "Carte d'identité / Passeport (en cours de validité)", status: "missing", detail: "Non importé" },
    { id: "permis", icon: "🚗", name: "Permis de conduire (en cours de validité)", status: "missing", detail: "Non importé" },
    {
      id: "justif-domicile",
      icon: "⚡",
      name: "Justificatif de domicile -3 mois",
      subOption: "Justif. domicile hébergeur + CNI hébergeur",
      status: "missing",
      detail: "Non importé",
    },
  ];

  if (withFinancement) {
    list.push(
      { id: "bulletin1", icon: "💶", name: "Bulletin de salaire 1 (mois -1)", status: "missing", detail: "Non importé" },
      { id: "bulletin2", icon: "💶", name: "Bulletin de salaire 2 (mois -2)", status: "missing", detail: "Non importé" },
      { id: "bulletin3", icon: "💶", name: "Bulletin de salaire 3 (mois -3)", status: "missing", detail: "Non importé" },
      { id: "avis-imposition", icon: "📄", name: "Dernier avis d'imposition", status: "missing", detail: "Non importé" },
      { id: "rib", icon: "🏦", name: "RIB", status: "missing", detail: "Non importé" }
    );
  }

  if (secondProprietaire) {
    list.push(
      { id: "cni-second", icon: "🪪", name: "CNI / Passeport second propriétaire", status: "missing", detail: "Non importé" },
      {
        id: "justif-second",
        icon: "⚡",
        name: "Justificatif de domicile second propriétaire",
        status: "missing",
        detail: "Non importé",
      }
    );
  }

  return list;
}

const chips = ["CNI / Passeport", "Permis de conduire", "Justif. domicile", "Fiches de paie", "Avis d'imposition", "RIB"];

type DocumentsClientProps = {
  vehiculeFinancement: string;
  onDocumentsChange?: (uploadedCount: number) => void;
  currentAdresse?: string;
  onExtractedData?: (
    patch: Partial<BonDraftData>,
    highlightedFields: Array<keyof BonDraftData>
  ) => void;
};

const DocumentsClient = ({
  vehiculeFinancement,
  onDocumentsChange,
  currentAdresse,
  onExtractedData,
}: DocumentsClientProps) => {
  const [secondProprietaire, setSecondProprietaire] = useState(false);
  const importRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [analysisStore, setAnalysisStore] = useState<Record<string, Record<string, string>>>({});

  const [docs, setDocs] = useState<DocItem[]>(() =>
    buildDocsList(vehiculeFinancement, secondProprietaire)
  );

  useEffect(() => {
    setDocs(buildDocsList(vehiculeFinancement, secondProprietaire));
  }, [vehiculeFinancement, secondProprietaire]);

  const uploadedCount = docs.filter((d) => d.status !== "missing").length;
  useEffect(() => {
    onDocumentsChange?.(uploadedCount);
  }, [uploadedCount, onDocumentsChange]);

  const scanned = docs.filter((d) => d.status === "ok").length;

  const getKindFromDocId = (id: string): DocumentKind | null => {
    if (id === "cni" || id === "cni-second") return "cni";
    if (id === "permis") return "permis";
    if (id === "justif-domicile" || id === "justif-second") return "justificatif_domicile";
    if (id.startsWith("bulletin")) return "fiche_paie";
    if (id === "avis-imposition") return "avis_imposition";
    if (id === "rib") return "rib";
    return null;
  };

  const mapExtractedToForm = (
    kind: DocumentKind,
    extracted: Record<string, string>
  ): { patch: Partial<BonDraftData>; fields: Array<keyof BonDraftData> } => {
    const patch: Partial<BonDraftData> = {};
    const fields: Array<keyof BonDraftData> = [];

    if (kind === "cni") {
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
      if (extracted.adresse) {
        patch.clientAdresse = extracted.adresse;
        fields.push("clientAdresse");
      }
      if (extracted.numero_cni) {
        patch.clientNumeroCni = extracted.numero_cni;
        fields.push("clientNumeroCni");
      }
    }

    if (kind === "justificatif_domicile" && extracted.adresse_complete && !currentAdresse?.trim()) {
      patch.clientAdresse = extracted.adresse_complete;
      fields.push("clientAdresse");
    }

    return { patch, fields };
  };

  const handleFileUpload = async (file: File, docId: string) => {
    const kind = getKindFromDocId(docId);
    setDocs((prev) =>
      prev.map((d) =>
        d.id === docId ? { ...d, status: "pending", detail: "⏳ Analyse en cours..." } : d
      )
    );

    if (!kind) {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === docId
            ? { ...d, status: "unreadable", detail: "❌ Illisible — Type de document non reconnu" }
            : d
        )
      );
      return;
    }

    const analysis = await analyzeDocument(file, kind);

    if (analysis.status === "valid" && analysis.validation.isValid) {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === docId ? { ...d, status: "ok", detail: "✅ Validé" } : d
        )
      );
      const mapped = mapExtractedToForm(kind, analysis.extractedData);
      if (kind === "fiche_paie" || kind === "rib") {
        setAnalysisStore((prev) => ({ ...prev, [docId]: analysis.extractedData }));
      }
      if (Object.keys(mapped.patch).length > 0) {
        onExtractedData?.(mapped.patch, mapped.fields);
      }
      toast({ title: "Données extraites ✓" });
      return;
    }

    if (analysis.status === "invalid") {
      setDocs((prev) =>
        prev.map((d) =>
          d.id === docId
            ? {
                ...d,
                status: "invalid",
                detail: `⚠️ Document invalide — ${analysis.validation.reason ?? "validation échouée"}`,
              }
            : d
        )
      );
      return;
    }

    setDocs((prev) =>
      prev.map((d) =>
        d.id === docId
          ? { ...d, status: "unreadable", detail: "❌ Illisible — Document illisible, veuillez réimporter" }
          : d
      )
    );
  };

  const handleFileChangeForDoc = async (
    e: React.ChangeEvent<HTMLInputElement>,
    docId: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      e.target.value = "";
      return;
    }
    await handleFileUpload(file, docId);
    e.target.value = "";
  };

  return (
    <div className="card-autodocs col-span-2">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">📁 Documents client</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-warning/15 text-warning">
          {scanned} / {docs.length} scannés
        </span>
      </div>

      {/* Upload area */}
      <div className="relative">
        <div
          className="relative border-2 border-dashed rounded-[10px] py-7 px-4 text-center transition-all duration-200 overflow-hidden border-border bg-primary/[0.02]"
        >
          <div className="absolute inset-0 pointer-events-none" style={{
            background: "radial-gradient(ellipse at 50% 0%, hsla(228,91%,64%,0.08) 0%, transparent 70%)"
          }} />
          <Upload className="w-8 h-8 mx-auto mb-2.5 text-muted-foreground" />
          <div className="font-display text-[15px] font-bold mb-1">Scanner ou importer des documents</div>
          <div className="text-xs text-muted-foreground mb-4">
            Types acceptés pour import/analyse
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {chips.map((c) => (
              <span key={c} className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground bg-secondary">
                {c}
              </span>
            ))}
          </div>
        </div>

      </div>

      {/* Case à cocher second propriétaire */}
      <label className="flex items-center gap-2 mt-3.5 cursor-pointer">
        <input
          type="checkbox"
          checked={secondProprietaire}
          onChange={(e) => setSecondProprietaire(e.target.checked)}
          className="rounded border-border bg-background"
        />
        <span className="text-sm text-foreground">Ajouter un second propriétaire</span>
      </label>

      {/* Docs list */}
      <div className="flex flex-col gap-2 mt-3.5">
        {docs.map((doc) => (
          <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 bg-secondary rounded-lg border border-border">
            <div className={`w-8 h-8 rounded-md flex items-center justify-center text-sm shrink-0 ${
              doc.status === "ok"
                ? "bg-success/10"
                : doc.status === "pending"
                  ? "bg-warning/10 animate-pulse"
                  : doc.status === "invalid"
                    ? "bg-warning/10"
                    : doc.status === "unreadable"
                      ? "bg-destructive/10"
                      : "bg-muted-foreground/10"
            }`}>
              {doc.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium">{doc.name}</div>
              {doc.subOption && (
                <div className="text-[11px] text-muted-foreground mt-0.5">→ {doc.subOption}</div>
              )}
              <div className="text-[11px] text-muted-foreground truncate">{doc.detail}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                ref={(el) => {
                  importRefs.current[doc.id] = el;
                }}
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => handleFileChangeForDoc(e, doc.id)}
              />
              <input
                ref={(el) => {
                  cameraRefs.current[doc.id] = el;
                }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFileChangeForDoc(e, doc.id)}
              />
              <button
                type="button"
                className="px-2 py-1 rounded-md text-[11px] border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                onClick={() => importRefs.current[doc.id]?.click()}
              >
                📎 Importer
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-md text-[11px] border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                onClick={() => cameraRefs.current[doc.id]?.click()}
              >
                📷 Scanner
              </button>
            </div>
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                doc.status === "ok"
                  ? "bg-success"
                  : doc.status === "pending"
                    ? "bg-warning animate-pulse"
                    : doc.status === "invalid"
                      ? "bg-warning"
                      : doc.status === "unreadable"
                        ? "bg-destructive"
                        : "bg-muted-foreground"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentsClient;

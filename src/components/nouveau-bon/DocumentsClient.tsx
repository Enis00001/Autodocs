import React, { useState, useRef, useEffect } from "react";
import { Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { analyzeDocument, type AnalyzeResult, type DocumentKind } from "@/utils/analyzeDocument";
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

function buildDocsList(vehiculeFinancement: string, secondProprietaire: boolean): DocItem[] {
  const withFinancement = isFinancement(vehiculeFinancement);
  const list: DocItem[] = [
    {
      id: "cni",
      icon: "🪪",
      name: "Carte d'identité / Passeport (en cours de validité)",
      status: "missing",
      detail: "Recto et verso requis",
    },
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
  ribTitulaire: string;
  ribIban: string;
  ribBic: string;
  ribBanque: string;
  onExtractedData?: (
    patch: Partial<BonDraftData>,
    highlightedFields: Array<keyof BonDraftData>
  ) => void;
};

const DocumentsClient = ({
  vehiculeFinancement,
  onDocumentsChange,
  currentAdresse,
  ribTitulaire,
  ribIban,
  ribBic,
  ribBanque,
  onExtractedData,
}: DocumentsClientProps) => {
  const [secondProprietaire, setSecondProprietaire] = useState(false);
  const importRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [analysisStore, setAnalysisStore] = useState<
    Record<
      string,
      {
        status: AnalyzeResult["status"];
        extractedData: Record<string, string>;
        validation: AnalyzeResult["validation"];
      }
    >
  >({});

  const [docs, setDocs] = useState<DocItem[]>(() =>
    buildDocsList(vehiculeFinancement, secondProprietaire)
  );

  const [cniModalOpen, setCniModalOpen] = useState(false);
  const [cniRectoFile, setCniRectoFile] = useState<File | null>(null);
  const [cniVersoFile, setCniVersoFile] = useState<File | null>(null);
  const [cniRectoPreview, setCniRectoPreview] = useState<string | null>(null);
  const [cniVersoPreview, setCniVersoPreview] = useState<string | null>(null);
  const cniRectoImportRef = useRef<HTMLInputElement | null>(null);
  const cniRectoCameraRef = useRef<HTMLInputElement | null>(null);
  const cniVersoImportRef = useRef<HTMLInputElement | null>(null);
  const cniVersoCameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDocs((prev) => {
      const next = buildDocsList(vehiculeFinancement, secondProprietaire);
      return next.map((doc) => {
        const existing = prev.find((d) => d.id === doc.id);
        return existing ? existing : doc;
      });
    });
  }, [vehiculeFinancement, secondProprietaire]);

  useEffect(() => {
    return () => {
      if (cniRectoPreview) URL.revokeObjectURL(cniRectoPreview);
      if (cniVersoPreview) URL.revokeObjectURL(cniVersoPreview);
    };
  }, [cniRectoPreview, cniVersoPreview]);

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
    extracted: Record<string, string>,
    sourceDocId?: string
  ): { patch: Partial<BonDraftData>; fields: Array<keyof BonDraftData> } => {
    const patch: Partial<BonDraftData> = {};
    const fields: Array<keyof BonDraftData> = [];

    if (kind === "cni") {
      // On ne remplit que le profil principal via la CNI (docId "cni").
      if (sourceDocId !== "cni") return { patch: {}, fields: [] };
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

    if (kind === "justificatif_domicile" && sourceDocId === "justif-domicile" && extracted.adresse_complete) {
      patch.clientAdresse = extracted.adresse_complete;
      fields.push("clientAdresse");
    }

    if (kind === "rib") {
      if (sourceDocId !== "rib") return { patch: {}, fields: [] };
      if (extracted.titulaire) {
        patch.ribTitulaire = extracted.titulaire;
        fields.push("ribTitulaire");
      }
      if (extracted.iban) {
        patch.ribIban = extracted.iban;
        fields.push("ribIban");
      }
      if (extracted.bic) {
        patch.ribBic = extracted.bic;
        fields.push("ribBic");
      }
      if (extracted.banque) {
        patch.ribBanque = extracted.banque;
        fields.push("ribBanque");
      }
    }

    return { patch, fields };
  };

  const mergeExtracted = (base: Record<string, string>, incoming: Record<string, string>) => {
    const next = { ...base };
    Object.entries(incoming).forEach(([key, value]) => {
      if (typeof value === "string" && value.trim()) {
        next[key] = value;
      }
    });
    return next;
  };

  const statusDotClass = (status: DocItem["status"]) => {
    if (status === "ok") return "bg-success";
    if (status === "pending") return "bg-warning animate-pulse";
    if (status === "invalid") return "bg-warning";
    if (status === "unreadable") return "bg-destructive";
    return "bg-muted-foreground";
  };

  const formatFrenchDate = (value?: string): string => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const m = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (m) return `${m[1]}/${m[2]}/${m[3]}`;
    return raw;
  };

  const formatEuro = (value?: string): string => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.replace(/[^\d,.\-]/g, "").replace(",", ".");
    const n = Number(normalized);
    if (!Number.isFinite(n)) return `${raw}€`;
    return `${n.toLocaleString("fr-FR")}€`;
  };

  const extractPermisCategoryB = (value?: string): string => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    // Cas le plus courant: "B" / "B, C" / "B; C"
    if (raw.includes("B")) return "B";
    const parts = raw.split(/[,;|]/).map((p) => p.trim());
    const found = parts.find((p) => p.startsWith("B")) ?? parts[0];
    return found || "—";
  };

  const updateDocStatus = (docId: string, status: DocItem["status"], detail: string) => {
    setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, status, detail } : d)));
  };

  const handleFileUpload = async (file: File, docId: string) => {
    const kind = getKindFromDocId(docId);
    updateDocStatus(docId, "pending", "⏳ Analyse en cours...");

    if (!kind) {
      updateDocStatus(docId, "unreadable", "❌ Illisible — Type de document non reconnu");
      return;
    }

    const analysis = await analyzeDocument(file, kind);

    const shouldStore =
      kind === "justificatif_domicile" ||
      kind === "rib" ||
      kind === "fiche_paie" ||
      kind === "permis" ||
      kind === "avis_imposition";

    if (shouldStore) {
      setAnalysisStore((prev) => ({
        ...prev,
        [docId]: {
          status: analysis.status,
          extractedData: analysis.extractedData,
          validation: analysis.validation,
        },
      }));
    }

    if (analysis.status === "valid" && analysis.validation.isValid) {
      updateDocStatus(docId, "ok", "✅ Validé");
      const mapped = mapExtractedToForm(kind, analysis.extractedData, docId);
      if (Object.keys(mapped.patch).length > 0) {
        onExtractedData?.(mapped.patch, mapped.fields);
      }
      toast({ title: "Données extraites ✓" });
      return;
    }

    if (analysis.status === "invalid") {
      updateDocStatus(
        docId,
        "invalid",
        `⚠️ Document invalide — ${analysis.validation.reason ?? "validation échouée"}`
      );
      return;
    }

    updateDocStatus(
      docId,
      "unreadable",
      `❌ Illisible — ${analysis.validation.reason ?? "Document illisible, veuillez réimporter"}`
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

  const onCniSideFileSelected = (side: "recto" | "verso", file: File) => {
    if (side === "recto") {
      if (cniRectoPreview) URL.revokeObjectURL(cniRectoPreview);
      setCniRectoFile(file);
      setCniRectoPreview(URL.createObjectURL(file));
    } else {
      if (cniVersoPreview) URL.revokeObjectURL(cniVersoPreview);
      setCniVersoFile(file);
      setCniVersoPreview(URL.createObjectURL(file));
    }
  };

  const handleCniSideInput = (
    e: React.ChangeEvent<HTMLInputElement>,
    side: "recto" | "verso"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onCniSideFileSelected(side, file);
    e.target.value = "";
  };

  const handleConfirmCni = async () => {
    if (!cniRectoFile || !cniVersoFile) return;

    setCniModalOpen(false);
    updateDocStatus("cni", "pending", "⏳ Analyse recto + verso en cours...");

    const [rectoAnalysis, versoAnalysis] = await Promise.all([
      analyzeDocument(cniRectoFile, "cni"),
      analyzeDocument(cniVersoFile, "cni"),
    ]);

    const mergedExtracted = mergeExtracted(
      rectoAnalysis.extractedData ?? {},
      versoAnalysis.extractedData ?? {}
    );
    const mapped = mapExtractedToForm("cni", mergedExtracted, "cni");

    const rectoOk = rectoAnalysis.status === "valid" && rectoAnalysis.validation.isValid;
    const versoOk = versoAnalysis.status === "valid" && versoAnalysis.validation.isValid;

    if (rectoOk && versoOk) {
      updateDocStatus("cni", "ok", "✅ CNI complète (recto + verso)");
      if (Object.keys(mapped.patch).length > 0) {
        onExtractedData?.(mapped.patch, mapped.fields);
      }
      toast({ title: "CNI analysée ✓" });
      return;
    }

    const reasons = [rectoAnalysis.validation.reason, versoAnalysis.validation.reason]
      .filter((r): r is string => Boolean(r && r.trim()))
      .join(" | ");

    const hasInvalid = rectoAnalysis.status === "invalid" || versoAnalysis.status === "invalid";
    updateDocStatus(
      "cni",
      hasInvalid ? "invalid" : "unreadable",
      `${hasInvalid ? "⚠️" : "❌"} ${reasons || (hasInvalid ? "CNI invalide" : "CNI illisible")}`
    );
  };

  const cniCanConfirm = Boolean(cniRectoFile && cniVersoFile);

  return (
    <div className="card-autodocs col-span-2">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">📁 Documents client</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-warning/15 text-warning">
          {scanned} / {docs.length} scannés
        </span>
      </div>

      <div className="relative">
        <div className="relative border-2 border-dashed rounded-[10px] py-7 px-4 text-center transition-all duration-200 overflow-hidden border-border bg-primary/[0.02]">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at 50% 0%, hsla(228,91%,64%,0.08) 0%, transparent 70%)",
            }}
          />
          <Upload className="w-8 h-8 mx-auto mb-2.5 text-muted-foreground" />
          <div className="font-display text-[15px] font-bold mb-1">Scanner ou importer des documents</div>
          <div className="text-xs text-muted-foreground mb-4">Types acceptés pour import/analyse</div>
          <div className="flex gap-2 justify-center flex-wrap">
            {chips.map((c) => (
              <span key={c} className="text-[11px] px-2.5 py-1 rounded-full border border-border text-muted-foreground bg-secondary">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 mt-3.5 cursor-pointer">
        <input
          type="checkbox"
          checked={secondProprietaire}
          onChange={(e) => setSecondProprietaire(e.target.checked)}
          className="rounded border-border bg-background"
        />
        <span className="text-sm text-foreground">Ajouter un second propriétaire</span>
      </label>

      <div className="flex flex-col gap-2 mt-3.5">
        {docs.map((doc) => {
          const stored = analysisStore[doc.id];

          const canEditJustif =
            doc.id === "justif-domicile" && doc.status === "ok" && Boolean(stored?.validation?.isValid);
          const canEditRib =
            doc.id === "rib" && doc.status === "ok" && Boolean(stored?.validation?.isValid);

          const isBulletin = doc.id.startsWith("bulletin");
          const isPermis = doc.id === "permis";
          const isAvis = doc.id === "avis-imposition";

          return (
            <React.Fragment key={doc.id}>
              <div className="flex flex-col gap-3 px-3 py-3 bg-secondary rounded-lg border border-border md:flex-row md:items-center md:gap-3 md:py-2.5">
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center text-sm shrink-0 ${
                    doc.status === "ok"
                      ? "bg-success/10"
                      : doc.status === "pending"
                        ? "bg-warning/10 animate-pulse"
                        : doc.status === "invalid"
                          ? "bg-warning/10"
                          : doc.status === "unreadable"
                            ? "bg-destructive/10"
                            : "bg-muted-foreground/10"
                  }`}
                >
                  {doc.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium">
                    {doc.id === "cni" ? (
                      <button
                        type="button"
                        className="text-left hover:text-primary transition-colors cursor-pointer"
                        onClick={() => setCniModalOpen(true)}
                      >
                        {doc.name}
                      </button>
                    ) : (
                      doc.name
                    )}
                  </div>
                  {doc.subOption && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">→ {doc.subOption}</div>
                  )}
                  <div className="text-[11px] text-muted-foreground truncate">{doc.detail}</div>
                </div>
                {doc.id === "cni" ? (
                  <button
                    type="button"
                    className="min-h-11 w-full md:w-auto px-3 py-2 rounded-md text-xs font-medium border border-border text-foreground hover:border-primary transition-colors bg-transparent cursor-pointer"
                    onClick={() => setCniModalOpen(true)}
                  >
                    Ouvrir
                  </button>
                ) : (
                  <div className="flex w-full items-stretch gap-2 shrink-0 md:w-auto md:items-center md:gap-1.5">
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
                      className="min-h-11 flex-1 touch-manipulation rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground cursor-pointer md:min-h-0 md:flex-none md:px-2 md:py-1 md:text-[11px]"
                      onClick={() => importRefs.current[doc.id]?.click()}
                    >
                      📎 Importer
                    </button>
                    <button
                      type="button"
                      className="min-h-11 flex-1 touch-manipulation rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground cursor-pointer md:min-h-0 md:flex-none md:px-2 md:py-1 md:text-[11px]"
                      onClick={() => cameraRefs.current[doc.id]?.click()}
                    >
                      📷 Scanner
                    </button>
                  </div>
                )}
                <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(doc.status)}`} />
              </div>

              {/* Résumé + édition sous la ligne */}
              {canEditJustif && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="card-title-autodocs">Justificatif de domicile</div>
                  <div className="flex flex-col gap-1.5 mt-2">
                    <label className="field-label">Adresse complète extraite</label>
                    <input
                      type="text"
                      value={currentAdresse ?? ""}
                      onChange={(e) =>
                        onExtractedData?.(
                          { clientAdresse: e.target.value },
                          ["clientAdresse"]
                        )
                      }
                      className="field-input"
                    />
                  </div>
                </div>
              )}

              {canEditRib && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="card-title-autodocs">RIB</div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Titulaire</label>
                      <input
                        type="text"
                        value={ribTitulaire}
                        onChange={(e) =>
                          onExtractedData?.(
                            { ribTitulaire: e.target.value },
                            ["ribTitulaire"]
                          )
                        }
                        className="field-input"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">IBAN</label>
                      <input
                        type="text"
                        value={ribIban}
                        onChange={(e) =>
                          onExtractedData?.(
                            { ribIban: e.target.value },
                            ["ribIban"]
                          )
                        }
                        className="field-input"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">BIC</label>
                      <input
                        type="text"
                        value={ribBic}
                        onChange={(e) =>
                          onExtractedData?.(
                            { ribBic: e.target.value },
                            ["ribBic"]
                          )
                        }
                        className="field-input"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="field-label">Banque</label>
                      <input
                        type="text"
                        value={ribBanque}
                        onChange={(e) =>
                          onExtractedData?.(
                            { ribBanque: e.target.value },
                            ["ribBanque"]
                          )
                        }
                        className="field-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {isBulletin && stored?.extractedData && doc.status === "ok" && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="card-title-autodocs">Fiche de paie</div>
                  <div className="flex flex-col gap-1.5 mt-2 text-[13px]">
                    <div>
                      <span className="field-label">Employeur</span>
                      <div className="text-foreground">{stored.extractedData.employeur || "—"}</div>
                    </div>
                    <div>
                      <span className="field-label">Salaire net</span>
                      <div className="text-foreground">{stored.extractedData.salaire_net || "—"}</div>
                    </div>
                    <div>
                      <span className="field-label">Période</span>
                      <div className="text-foreground">{stored.extractedData.periode || "—"}</div>
                    </div>
                  </div>
                </div>
              )}

              {isPermis && stored?.extractedData && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="card-title-autodocs">Permis de conduire</div>
                  <div className="mt-2 text-[13px] font-semibold">
                    {stored.validation.isValid ? (
                      <>
                        ✅ Permis valide — Catégorie {extractPermisCategoryB(stored.extractedData.categories)} —{" "}
                        {stored.extractedData.date_expiration ? (
                          <>Expire le {formatFrenchDate(stored.extractedData.date_expiration)}</>
                        ) : (
                          <>Expire le —</>
                        )}
                      </>
                    ) : (
                      <>❌ Permis invalide/expiré</>
                    )}
                  </div>
                </div>
              )}

              {isAvis && stored?.extractedData && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="card-title-autodocs">Avis d'imposition</div>
                  <div className="mt-2 text-[13px] font-semibold">
                    {stored.validation.isValid ? (
                      <>
                        ✅ Avis {stored.extractedData.annee || "—"} — Revenu fiscal : {formatEuro(stored.extractedData.revenu_fiscal || "")}
                      </>
                    ) : (
                      <>⚠️ Avis trop ancien</>
                    )}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {cniModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in-0 duration-200"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setCniModalOpen(false)}
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
                const preview = isRecto ? cniRectoPreview : cniVersoPreview;
                return (
                  <div key={side} className="rounded-xl border border-border bg-secondary/40 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-sm font-bold">{isRecto ? "Recto" : "Verso"}</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${statusDotClass(preview ? "ok" : "missing")}`} />
                    </div>

                    <button
                      type="button"
                      className="w-full h-[150px] rounded-lg border border-dashed border-border bg-card hover:border-primary transition-colors flex items-center justify-center overflow-hidden"
                      onClick={() =>
                        (isRecto ? cniRectoImportRef.current : cniVersoImportRef.current)?.click()
                      }
                    >
                      {preview ? (
                        <img src={preview} alt={`Aperçu ${side}`} className="h-full max-h-[150px] w-full object-cover" />
                      ) : (
                        <span className="text-xs text-muted-foreground">Zone de drop/upload</span>
                      )}
                    </button>

                    <div className="flex gap-2">
                      <input
                        ref={isRecto ? cniRectoImportRef : cniVersoImportRef}
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => handleCniSideInput(e, side)}
                      />
                      <input
                        ref={isRecto ? cniRectoCameraRef : cniVersoCameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleCniSideInput(e, side)}
                      />
                      <button
                        type="button"
                        className="min-h-11 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer"
                        onClick={() =>
                          (isRecto ? cniRectoCameraRef.current : cniVersoCameraRef.current)?.click()
                        }
                      >
                        📷 Scanner
                      </button>
                      <button
                        type="button"
                        className="min-h-11 flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors cursor-pointer"
                        onClick={() =>
                          (isRecto ? cniRectoImportRef.current : cniVersoImportRef.current)?.click()
                        }
                      >
                        📎 Importer
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                disabled={!cniCanConfirm}
                className="min-h-11 px-4 py-2.5 rounded-lg text-sm font-medium gradient-primary text-primary-foreground border-0 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                onClick={handleConfirmCni}
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

export default DocumentsClient;

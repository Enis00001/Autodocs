import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  Car,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  ArrowLeft,
  ArrowRight,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import { getCurrentUserId } from "@/lib/auth";
import {
  clearStock,
  deleteVehicule,
  detectColumnMapping,
  importVehicules,
  loadStockVehicules,
  mapRowToVehicule,
  markAsSold,
  stringifyCell,
  STOCK_FIELDS,
  STOCK_FIELD_LABELS,
  type StockField,
  type StockVehicule,
  type StockVehiculeInput,
} from "@/utils/stockVehicules";

/* -------------------------------------------------------------------------- */
/*                          Types locaux du wizard                            */
/* -------------------------------------------------------------------------- */

type WizardStep = "upload" | "mapping" | "preview";

/** Configuration d'une colonne du fichier importé. */
type ColumnConfig = {
  /** En-tête tel qu'il figure dans le fichier (ex: "Marque véhicule"). */
  header: string;
  /** Champ standard mappé (ex: "marque") ou "ignore". */
  target: StockField | "ignore";
  /** Apparaît dans le PDF ? Seules les colonnes ON avec `target ≠ ignore` comptent. */
  active: boolean;
  /** Première valeur non vide (pour l'aperçu en italique). */
  preview: string;
};

type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
};

/* -------------------------------------------------------------------------- */
/*                                   Page                                     */
/* -------------------------------------------------------------------------- */

const StockVehicules = () => {
  const [concessionId, setConcessionId] = useState<string | null>(null);
  const [vehicules, setVehicules] = useState<StockVehicule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"tous" | "disponibles" | "vendus">("tous");

  // Wizard d'import
  const [step, setStep] = useState<WizardStep>("upload");
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ------------------------------ data loading ------------------------------ */

  const refresh = async (uid: string) => {
    setLoading(true);
    try {
      const rows = await loadStockVehicules(uid);
      setVehicules(rows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const uid = await getCurrentUserId();
      setConcessionId(uid);
      if (uid) await refresh(uid);
      else setLoading(false);
    })();
  }, []);

  const filteredVehicules = useMemo(() => {
    if (filter === "disponibles") return vehicules.filter((v) => v.disponible);
    if (filter === "vendus") return vehicules.filter((v) => !v.disponible);
    return vehicules;
  }, [vehicules, filter]);

  const stats = useMemo(
    () => ({
      total: vehicules.length,
      disponibles: vehicules.filter((v) => v.disponible).length,
      vendus: vehicules.filter((v) => !v.disponible).length,
    }),
    [vehicules],
  );

  /* --------------------------- Étape 1 : upload ----------------------------- */

  const resetWizard = () => {
    setStep("upload");
    setParsed(null);
    setColumns([]);
  };

  const handleFilePick = () => fileInputRef.current?.click();

  const processFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) throw new Error("Fichier vide");
      const sheet = wb.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      });
      if (rows.length === 0) {
        toast({
          title: "Fichier vide",
          description: "Aucune ligne détectée dans le fichier.",
          variant: "destructive",
        });
        return;
      }
      const headers = Object.keys(rows[0]);
      const mapping = detectColumnMapping(headers);
      // inversion mapping : { header: StockField }
      const headerToField: Record<string, StockField> = {};
      for (const field of Object.keys(mapping) as StockField[]) {
        const h = mapping[field];
        if (h) headerToField[h] = field;
      }

      const initial: ColumnConfig[] = headers.map((header) => {
        const target = headerToField[header] ?? "ignore";
        // Préviewr la première valeur non vide.
        let preview = "";
        for (const row of rows) {
          const v = stringifyCell(row[header]);
          if (v) {
            preview = v;
            break;
          }
        }
        return {
          header,
          target,
          // ON si on a détecté un champ standard, OFF si c'est ignoré.
          active: target !== "ignore",
          preview,
        };
      });

      setParsed({ fileName: file.name, headers, rows });
      setColumns(initial);
      setStep("mapping");
      toast({
        title: "Fichier chargé",
        description: `${rows.length} ligne(s), ${headers.length} colonne(s) détectée(s).`,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Erreur de lecture",
        description: err instanceof Error ? err.message : "Fichier illisible.",
        variant: "destructive",
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await processFile(file);
  };

  /* ------------------------- Étape 2 : mapping/toggle ----------------------- */

  const updateColumn = (index: number, patch: Partial<ColumnConfig>) => {
    setColumns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      // Un champ standard ne doit être mappé qu'une fois. Si on change `target`,
      // on retire le même target sur les autres lignes pour éviter les doublons.
      if (patch.target && patch.target !== "ignore") {
        for (let i = 0; i < next.length; i++) {
          if (i !== index && next[i].target === patch.target) {
            next[i] = { ...next[i], target: "ignore", active: false };
          }
        }
      }
      // Si on passe la cible à "ignore", on désactive.
      if (patch.target === "ignore") next[index].active = false;
      return next;
    });
  };

  const setAllActive = (value: boolean) => {
    setColumns((prev) =>
      prev.map((c) =>
        c.target === "ignore" ? c : { ...c, active: value },
      ),
    );
  };

  const usedTargets = useMemo(() => {
    return new Set(
      columns
        .filter((c) => c.target !== "ignore")
        .map((c) => c.target as StockField),
    );
  }, [columns]);

  const activeColumns = useMemo(
    () => columns.filter((c) => c.active && c.target !== "ignore"),
    [columns],
  );

  const mappedColumnsCount = useMemo(
    () => columns.filter((c) => c.target !== "ignore").length,
    [columns],
  );

  const colonnesPdfList = useMemo<StockField[]>(
    () => activeColumns.map((c) => c.target as StockField),
    [activeColumns],
  );

  /* --------------------- Étape 3 : preview + confirmation -------------------- */

  /** Mapping `{ champCible: entêteSource }` reconstitué depuis les colonnes. */
  const effectiveMapping = useMemo<Partial<Record<StockField, string>>>(() => {
    const out: Partial<Record<StockField, string>> = {};
    for (const c of columns) {
      if (c.target === "ignore") continue;
      out[c.target] = c.header;
    }
    return out;
  }, [columns]);

  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.slice(0, 3).map((r) => mapRowToVehicule(r, effectiveMapping));
  }, [parsed, effectiveMapping]);

  const handleConfirmImport = async () => {
    if (!parsed || !concessionId) return;
    if (colonnesPdfList.length === 0) {
      toast({
        title: "Aucune colonne activée",
        description: "Activez au moins une colonne pour le PDF.",
        variant: "destructive",
      });
      return;
    }

    const toInsert: StockVehiculeInput[] = parsed.rows
      .map((row) => mapRowToVehicule(row, effectiveMapping))
      .filter(
        (v) =>
          (v.marque && v.marque.trim()) ||
          (v.modele && v.modele.trim()) ||
          (v.vin && v.vin.trim()),
      );

    if (toInsert.length === 0) {
      toast({
        title: "Aucune ligne valide",
        description: "Marque, modèle ou VIN doivent être renseignés.",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);
    try {
      await importVehicules(concessionId, toInsert, colonnesPdfList);
      toast({
        title: "Import réussi",
        description: `${toInsert.length} véhicule(s) ajouté(s) au stock. ${colonnesPdfList.length} colonne(s) visible(s) dans le PDF.`,
      });
      resetWizard();
      await refresh(concessionId);
    } catch (err) {
      toast({
        title: "Échec de l'import",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  /* ------------------------------ Actions cards ----------------------------- */

  const handleDelete = async (id: string) => {
    if (!window.confirm("Supprimer ce véhicule du stock ?")) return;
    try {
      await deleteVehicule(id);
      setVehicules((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      toast({
        title: "Suppression impossible",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  const handleMarkSold = async (id: string) => {
    try {
      await markAsSold(id);
      setVehicules((prev) =>
        prev.map((v) => (v.id === id ? { ...v, disponible: false } : v)),
      );
    } catch (err) {
      toast({
        title: "Action impossible",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  const handleClear = async () => {
    if (!concessionId) return;
    if (!window.confirm("Vider tout le stock ? Cette action est irréversible.")) return;
    try {
      await clearStock(concessionId);
      setVehicules([]);
      toast({ title: "Stock vidé" });
    } catch (err) {
      toast({
        title: "Échec",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  /* ---------------------------------- Render -------------------------------- */

  const wizardOpen = step !== "upload" || false; // placeholder si on veut forcer ouverture

  return (
    <>
      <TopBar
        title="Stock véhicules"
        actions={
          <>
            {vehicules.length > 0 && step === "upload" && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium border border-destructive/50 text-destructive hover:bg-destructive/10 transition-all bg-transparent cursor-pointer"
                onClick={handleClear}
              >
                Vider le stock
              </button>
            )}
            {step === "upload" && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2"
                style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
                onClick={handleFilePick}
              >
                <Upload className="w-4 h-4" />
                Importer CSV/Excel
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleFileChange}
            />
          </>
        }
      />

      <div className="page-shell">
        <div className="page-content space-y-5">
          {/* --- Stats : masquées pendant le wizard pour concentrer l'écran --- */}
          {step === "upload" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard label="Total stock" value={stats.total} accent="primary" />
              <StatCard label="Disponibles" value={stats.disponibles} accent="success" />
              <StatCard label="Vendus" value={stats.vendus} accent="muted" />
            </div>
          )}

          {/* --- Wizard étape 2 --- */}
          {step === "mapping" && parsed && (
            <MappingStep
              parsed={parsed}
              columns={columns}
              usedTargets={usedTargets}
              activeCount={activeColumns.length}
              mappedCount={mappedColumnsCount}
              onUpdate={updateColumn}
              onToggleAll={setAllActive}
              onCancel={resetWizard}
              onNext={() => setStep("preview")}
            />
          )}

          {/* --- Wizard étape 3 --- */}
          {step === "preview" && parsed && (
            <PreviewStep
              parsed={parsed}
              colonnesPdf={colonnesPdfList}
              previewRows={previewRows}
              importing={importing}
              onBack={() => setStep("mapping")}
              onConfirm={handleConfirmImport}
            />
          )}

          {/* --- Zone vide (pas d'import en cours, pas de véhicules) --- */}
          {step === "upload" && !loading && vehicules.length === 0 && (
            <UploadDropZone
              dragActive={dragActive}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onPick={handleFilePick}
            />
          )}

          {/* --- Liste véhicules --- */}
          {step === "upload" && vehicules.length > 0 && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {(["tous", "disponibles", "vendus"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      filter === f
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-muted-foreground"
                    }`}
                    onClick={() => setFilter(f)}
                  >
                    {f === "tous"
                      ? `Tous (${stats.total})`
                      : f === "disponibles"
                      ? `Disponibles (${stats.disponibles})`
                      : `Vendus (${stats.vendus})`}
                  </button>
                ))}
                {concessionId && (
                  <button
                    type="button"
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5"
                    onClick={() => void refresh(concessionId)}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rafraîchir
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {filteredVehicules.map((v) => (
                  <VehiculeCard
                    key={v.id}
                    vehicule={v}
                    onMarkSold={handleMarkSold}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </>
          )}

          {loading && !wizardOpen && vehicules.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">
              Chargement du stock…
            </div>
          )}
        </div>
      </div>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/*                        Étape 1 — Drop zone stylisée                        */
/* -------------------------------------------------------------------------- */

const UploadDropZone = ({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
}: {
  dragActive: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: () => void;
}) => (
  <div
    className={`card-autodocs flex flex-col items-center text-center py-12 transition-colors border-2 border-dashed ${
      dragActive
        ? "border-primary bg-primary/5"
        : "border-border/60 hover:border-muted-foreground/60"
    }`}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className="w-16 h-16 rounded-full gradient-primary flex items-center justify-center mb-4">
      <Upload className="w-8 h-8 text-primary-foreground" />
    </div>
    <h2 className="font-display text-lg font-bold mb-1">
      Glissez votre fichier CSV ou Excel ici
    </h2>
    <p className="text-sm text-muted-foreground max-w-md mb-4">
      Formats acceptés : <span className="text-foreground">.csv, .xlsx, .xls</span>
      <br />
      Vous pourrez ensuite choisir les colonnes à afficher dans le bon de commande.
    </p>
    <button
      type="button"
      className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2"
      onClick={onPick}
    >
      <FileSpreadsheet className="w-4 h-4" />
      Parcourir
    </button>
  </div>
);

/* -------------------------------------------------------------------------- */
/*                  Étape 2 — Configuration des colonnes                      */
/* -------------------------------------------------------------------------- */

const MappingStep = ({
  parsed,
  columns,
  usedTargets,
  activeCount,
  mappedCount,
  onUpdate,
  onToggleAll,
  onCancel,
  onNext,
}: {
  parsed: ParsedFile;
  columns: ColumnConfig[];
  usedTargets: Set<StockField>;
  activeCount: number;
  mappedCount: number;
  onUpdate: (i: number, patch: Partial<ColumnConfig>) => void;
  onToggleAll: (v: boolean) => void;
  onCancel: () => void;
  onNext: () => void;
}) => {
  return (
    <div className="card-autodocs space-y-5">
      {/* Entête */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
              2
            </div>
            <h2 className="font-display text-lg font-bold">Configurez vos colonnes</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl">
            Activez les colonnes que vous voulez voir apparaître dans le{" "}
            <span className="text-foreground font-medium">bon de commande</span>. Les
            colonnes désactivées seront importées dans le stock mais n'apparaîtront
            pas dans le PDF.
          </p>
          <div className="text-[11px] text-muted-foreground mt-1.5">
            Fichier : <span className="text-foreground">{parsed.fileName}</span> •{" "}
            {parsed.rows.length} ligne(s) • {parsed.headers.length} colonne(s) détectée(s)
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer"
            onClick={onCancel}
          >
            Annuler
          </button>
        </div>
      </div>

      {/* Barre d'actions groupées */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 flex-wrap">
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span>
            <span className="text-foreground font-medium">{mappedCount}</span> colonne(s) mappée(s)
          </span>
          <span>
            <span className="text-[hsl(var(--success))] font-medium">{activeCount}</span> dans le PDF
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border border-[hsl(var(--success))]/50 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10 transition-colors bg-transparent cursor-pointer inline-flex items-center gap-1.5"
            onClick={() => onToggleAll(true)}
          >
            <Eye className="w-3.5 h-3.5" />
            Tout activer
          </button>
          <button
            type="button"
            className="px-2.5 py-1.5 rounded-md text-[11px] font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer inline-flex items-center gap-1.5"
            onClick={() => onToggleAll(false)}
          >
            <EyeOff className="w-3.5 h-3.5" />
            Tout désactiver
          </button>
        </div>
      </div>

      {/* Liste des colonnes */}
      <div className="space-y-2">
        {columns.map((col, i) => (
          <ColumnRow
            key={col.header + i}
            col={col}
            usedTargets={usedTargets}
            onUpdate={(patch) => onUpdate(i, patch)}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5"
          onClick={onCancel}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onNext}
          disabled={activeCount === 0}
          title={activeCount === 0 ? "Activez au moins une colonne" : undefined}
        >
          Aperçu & import
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const ColumnRow = ({
  col,
  usedTargets,
  onUpdate,
}: {
  col: ColumnConfig;
  usedTargets: Set<StockField>;
  onUpdate: (patch: Partial<ColumnConfig>) => void;
}) => {
  const isIgnored = col.target === "ignore";
  const canToggle = !isIgnored;
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        isIgnored
          ? "border-border/40 bg-background/20"
          : col.active
          ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5"
          : "border-border/60 bg-background/30"
      }`}
    >
      {/* Toggle ON/OFF */}
      <button
        type="button"
        onClick={() => canToggle && onUpdate({ active: !col.active })}
        aria-pressed={col.active}
        disabled={!canToggle}
        title={
          canToggle
            ? col.active
              ? "Visible dans le PDF"
              : "Stockée uniquement (pas dans le PDF)"
            : "Cette colonne est ignorée"
        }
        className={`shrink-0 transition-colors ${
          canToggle ? "cursor-pointer" : "cursor-not-allowed opacity-40"
        }`}
      >
        {col.active ? (
          <ToggleRight className="w-7 h-7 text-[hsl(var(--success))]" />
        ) : (
          <ToggleLeft className="w-7 h-7 text-muted-foreground" />
        )}
      </button>

      {/* Nom colonne fichier + aperçu valeur */}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground truncate" title={col.header}>
          {col.header}
        </div>
        {col.preview && (
          <div
            className="text-[11px] text-muted-foreground italic truncate mt-0.5"
            title={col.preview}
          >
            Exemple : {col.preview}
          </div>
        )}
      </div>

      {/* Flèche */}
      <ArrowRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />

      {/* Dropdown cible */}
      <select
        className="field-input text-xs w-48 shrink-0"
        value={col.target}
        onChange={(e) => {
          const value = e.target.value as StockField | "ignore";
          onUpdate({
            target: value,
            // Si on sélectionne un vrai champ, on active par défaut.
            active: value !== "ignore" ? true : false,
          });
        }}
      >
        <option value="ignore">Ignorer cette colonne</option>
        {STOCK_FIELDS.map((f) => {
          const already = usedTargets.has(f) && col.target !== f;
          return (
            <option key={f} value={f} disabled={already}>
              {STOCK_FIELD_LABELS[f]}
              {already ? " (déjà utilisé)" : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                    Étape 3 — Aperçu + confirmation                         */
/* -------------------------------------------------------------------------- */

const PreviewStep = ({
  parsed,
  colonnesPdf,
  previewRows,
  importing,
  onBack,
  onConfirm,
}: {
  parsed: ParsedFile;
  colonnesPdf: StockField[];
  previewRows: StockVehiculeInput[];
  importing: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) => {
  return (
    <div className="card-autodocs space-y-5">
      {/* Entête */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">
              3
            </div>
            <h2 className="font-display text-lg font-bold">Aperçu & confirmation</h2>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Les 3 premières lignes telles qu'elles apparaîtront dans le bon de commande.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Fichier</div>
          <div className="text-[13px] font-medium text-foreground truncate max-w-[260px]">
            {parsed.fileName}
          </div>
        </div>
      </div>

      {/* Résumé */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3 flex-wrap">
        <Car className="w-5 h-5 text-primary shrink-0" />
        <div className="text-[13px]">
          <span className="font-bold text-foreground">{parsed.rows.length}</span>{" "}
          véhicule(s) à importer,{" "}
          <span className="font-bold text-foreground">{colonnesPdf.length}</span>{" "}
          colonne(s) dans le PDF
        </div>
      </div>

      {/* Tableau aperçu */}
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-[12px]">
          <thead className="bg-secondary/50">
            <tr className="text-left text-muted-foreground">
              {colonnesPdf.map((f) => (
                <th key={f} className="px-3 py-2 font-medium whitespace-nowrap">
                  {STOCK_FIELD_LABELS[f]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-border/40 row-hover"
              >
                {colonnesPdf.map((f) => (
                  <td
                    key={f}
                    className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate"
                    title={String(row[f] ?? "")}
                  >
                    {String(row[f] ?? "") || (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          onClick={onBack}
          disabled={importing}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Retour
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
            boxShadow: "0 0 22px rgba(99, 102, 241, 0.35)",
          }}
          onClick={onConfirm}
          disabled={importing}
        >
          {importing ? "Import en cours…" : "Confirmer l'import"}
        </button>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                                Sub components                              */
/* -------------------------------------------------------------------------- */

const StatCard = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "primary" | "success" | "muted";
}) => {
  const color =
    accent === "success"
      ? "text-[hsl(var(--success))]"
      : accent === "primary"
      ? "gradient-text"
      : "text-muted-foreground";
  return (
    <div className="card-autodocs flex items-center justify-between">
      <div>
        <div className="card-title-autodocs">{label}</div>
        <div className={`font-display text-2xl font-extrabold mt-1 ${color}`}>{value}</div>
      </div>
      <Car className="w-7 h-7 text-muted-foreground/60" />
    </div>
  );
};

const VehiculeCard = ({
  vehicule,
  onMarkSold,
  onDelete,
}: {
  vehicule: StockVehicule;
  onMarkSold: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const title = [vehicule.marque, vehicule.modele].filter(Boolean).join(" ") || "Véhicule";
  const colonnesCount = vehicule.colonnes_pdf?.length ?? 0;
  return (
    <div
      className={`card-autodocs flex flex-col gap-3 interactive-lift ${
        vehicule.disponible ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-[15px] font-bold truncate">{title}</h3>
            {vehicule.version && (
              <span className="text-[11px] text-muted-foreground">{vehicule.version}</span>
            )}
          </div>
          {vehicule.annee && (
            <div className="text-xs text-muted-foreground mt-0.5">{vehicule.annee}</div>
          )}
        </div>
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
            vehicule.disponible
              ? "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {vehicule.disponible ? "Disponible" : "Vendu"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
        <InfoLine label="Prix" value={vehicule.prix ? `${vehicule.prix} €` : "—"} highlight />
        <InfoLine label="Km" value={vehicule.kilometrage || "—"} />
        <InfoLine label="Couleur" value={vehicule.couleur || "—"} />
        <InfoLine label="Puiss." value={vehicule.puissance || "—"} />
        {vehicule.vin && (
          <div className="col-span-2">
            <InfoLine label="VIN" value={vehicule.vin} mono />
          </div>
        )}
      </div>

      {colonnesCount > 0 && (
        <div className="text-[10px] text-muted-foreground">
          <span className="text-[hsl(var(--success))]">●</span> {colonnesCount} champ(s) visible(s)
          dans le PDF
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-2 border-t border-border/40">
        {vehicule.disponible ? (
          <button
            type="button"
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-[hsl(var(--success))]/50 text-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/10 transition-all bg-transparent cursor-pointer"
            onClick={() => onMarkSold(vehicule.id)}
          >
            Marquer vendu
          </button>
        ) : (
          <div className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground text-center">
            Véhicule vendu
          </div>
        )}
        <button
          type="button"
          className="px-3 py-2 rounded-lg text-xs font-medium border border-destructive/50 text-destructive hover:bg-destructive/10 transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5"
          onClick={() => onDelete(vehicule.id)}
          aria-label="Supprimer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Supprimer
        </button>
      </div>
    </div>
  );
};

const InfoLine = ({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) => (
  <div className="flex items-baseline gap-1.5 min-w-0">
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">
      {label}
    </span>
    <span
      className={`truncate ${highlight ? "font-semibold text-foreground" : "text-foreground"} ${
        mono ? "font-mono text-[11px]" : ""
      }`}
      title={value}
    >
      {value}
    </span>
  </div>
);

export default StockVehicules;

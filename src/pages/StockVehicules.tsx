import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Upload,
  Car,
  Trash2,
  RefreshCw,
  FileSpreadsheet,
  ArrowLeft,
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
  importVehicules,
  loadStockVehicules,
  markAsSold,
  stringifyCell,
  vehiculeDisplayLabel,
  type StockVehicule,
  type StockVehiculeInput,
} from "@/utils/stockVehicules";

/* -------------------------------------------------------------------------- */

type ColumnConfig = {
  /** Nom exact de la colonne dans le fichier (conservé tel quel). */
  header: string;
  /** Apparaît dans le PDF / dans NouveauBon ? */
  active: boolean;
  /** Première valeur non vide de la colonne, pour l'aperçu. */
  preview: string;
};

type ParsedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

/* -------------------------------------------------------------------------- */

const StockVehicules = () => {
  const [concessionId, setConcessionId] = useState<string | null>(null);
  const [vehicules, setVehicules] = useState<StockVehicule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"tous" | "disponibles" | "vendus">("tous");

  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const inImportFlow = parsed !== null;

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

  /* ------------------------------ upload ------------------------------ */

  const resetWizard = () => {
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
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
        raw: false,
      });
      if (rawRows.length === 0) {
        toast({
          title: "Fichier vide",
          description: "Aucune ligne détectée dans le fichier.",
          variant: "destructive",
        });
        return;
      }
      // On normalise dès maintenant toutes les valeurs en string (simplifie tout
      // le pipeline en aval : affichage, import Supabase, PDF).
      const headers = Object.keys(rawRows[0]).filter((h) => h && h.trim());
      const rows: Record<string, string>[] = rawRows.map((r) => {
        const out: Record<string, string> = {};
        for (const h of headers) out[h] = stringifyCell(r[h]);
        return out;
      });

      const initial: ColumnConfig[] = headers.map((header) => {
        let preview = "";
        for (const row of rows) {
          if (row[header]) {
            preview = row[header];
            break;
          }
        }
        return { header, active: true, preview };
      });

      setParsed({ fileName: file.name, headers, rows });
      setColumns(initial);
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

  /* ----------------------------- toggles ------------------------------ */

  const updateColumn = (index: number, patch: Partial<ColumnConfig>) => {
    setColumns((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const setAllActive = (value: boolean) => {
    setColumns((prev) => prev.map((c) => ({ ...c, active: value })));
  };

  const activeHeaders = useMemo(
    () => columns.filter((c) => c.active).map((c) => c.header),
    [columns],
  );

  const previewRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.slice(0, 3);
  }, [parsed]);

  /* ---------------------------- confirmation --------------------------- */

  const handleConfirmImport = async () => {
    if (!parsed || !concessionId) return;
    if (activeHeaders.length === 0) {
      toast({
        title: "Aucune colonne activée",
        description: "Activez au moins une colonne pour l'import.",
        variant: "destructive",
      });
      return;
    }

    // On garde TOUTES les données du fichier dans `donnees` (utile pour le
    // stock) mais seules les colonnes activées iront dans le PDF via
    // `colonnes_pdf`.
    const toInsert: StockVehiculeInput[] = parsed.rows
      .filter((row) => {
        // Ligne considérée valide si au moins une colonne activée a une valeur.
        return activeHeaders.some((h) => (row[h] ?? "").trim() !== "");
      })
      .map((row) => ({
        donnees: row,
        colonnes_pdf: activeHeaders,
        disponible: true,
      }));

    if (toInsert.length === 0) {
      toast({
        title: "Aucune ligne valide",
        description: "Les lignes actives sont toutes vides.",
        variant: "destructive",
      });
      return;
    }

    setImporting(true);
    try {
      await importVehicules(concessionId, toInsert);
      toast({
        title: "Import réussi",
        description: `${toInsert.length} véhicule(s) ajouté(s). ${activeHeaders.length} colonne(s) dans le PDF.`,
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

  /* ------------------------------ actions ------------------------------ */

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

  /* -------------------------------- render ----------------------------- */

  return (
    <>
      <TopBar
        title="Stock véhicules"
        actions={
          <>
            {!inImportFlow && vehicules.length > 0 && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium border border-destructive/50 text-destructive hover:bg-destructive/10 transition-all bg-transparent cursor-pointer"
                onClick={handleClear}
              >
                Vider le stock
              </button>
            )}
            {!inImportFlow && (
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
            {inImportFlow && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
                onClick={() => void handleConfirmImport()}
                disabled={importing || activeHeaders.length === 0 || !concessionId}
              >
                {importing ? "Confirmation..." : "Confirmer"}
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
          {/* --- Stats --- */}
          {!inImportFlow && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard label="Total stock" value={stats.total} accent="primary" />
              <StatCard label="Disponibles" value={stats.disponibles} accent="success" />
              <StatCard label="Vendus" value={stats.vendus} accent="muted" />
            </div>
          )}

          {/* --- Import flow --- */}
          {inImportFlow && parsed && (
            <ImportFlow
              parsed={parsed}
              columns={columns}
              previewRows={previewRows}
              activeCount={activeHeaders.length}
              importing={importing}
              onUpdate={updateColumn}
              onToggleAll={setAllActive}
              onCancel={resetWizard}
              onConfirm={handleConfirmImport}
            />
          )}

          {/* --- Empty state --- */}
          {!inImportFlow && !loading && vehicules.length === 0 && (
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

          {/* --- Liste --- */}
          {!inImportFlow && vehicules.length > 0 && (
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

          {loading && !inImportFlow && vehicules.length === 0 && (
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
/*                             Upload drop zone                               */
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
      Les noms de colonnes de votre fichier seront utilisés tels quels dans le
      bon de commande.
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
/*                           Import flow (1 écran)                            */
/* -------------------------------------------------------------------------- */

const ImportFlow = ({
  parsed,
  columns,
  previewRows,
  activeCount,
  importing,
  onUpdate,
  onToggleAll,
  onCancel,
  onConfirm,
}: {
  parsed: ParsedFile;
  columns: ColumnConfig[];
  previewRows: Record<string, string>[];
  activeCount: number;
  importing: boolean;
  onUpdate: (i: number, patch: Partial<ColumnConfig>) => void;
  onToggleAll: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const activeHeaders = columns.filter((c) => c.active).map((c) => c.header);

  return (
    <div className="space-y-5">
      {/* Bloc 1 : toggles */}
      <div className="card-autodocs space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Colonnes à inclure</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Activez les colonnes que vous voulez voir apparaître dans le{" "}
              <span className="text-foreground font-medium">bon de commande</span>.
              Le nom exact de la colonne sera utilisé dans le PDF.
            </p>
            <div className="text-[11px] text-muted-foreground mt-1.5">
              Fichier : <span className="text-foreground">{parsed.fileName}</span>
              {" • "}
              {parsed.rows.length} ligne(s) • {parsed.headers.length} colonne(s)
            </div>
          </div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5"
            onClick={onCancel}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Annuler
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 flex-wrap">
          <div className="text-[11px] text-muted-foreground">
            <span className="text-[hsl(var(--success))] font-medium">{activeCount}</span>
            {" "}/ {columns.length} colonne(s) dans le PDF
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

        <div className="space-y-2">
          {columns.map((col, i) => (
            <ColumnRow key={col.header + i} col={col} onUpdate={(patch) => onUpdate(i, patch)} />
          ))}
        </div>
      </div>

      {/* Bloc 2 : aperçu */}
      <div className="card-autodocs space-y-4">
        <div>
          <h2 className="font-display text-lg font-bold">Aperçu</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Les 3 premières lignes telles qu'elles apparaîtront dans le bon de commande.
          </p>
        </div>

        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Car className="w-5 h-5 text-primary shrink-0" />
          <div className="text-[13px]">
            <span className="font-bold text-foreground">{parsed.rows.length}</span>{" "}
            véhicule(s) à importer,{" "}
            <span className="font-bold text-foreground">{activeCount}</span>{" "}
            colonne(s) dans le PDF
          </div>
        </div>

        {activeHeaders.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-background/30 px-4 py-6 text-center text-sm text-muted-foreground">
            Activez au moins une colonne pour voir l'aperçu.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-[12px]">
              <thead className="bg-secondary/50">
                <tr className="text-left text-muted-foreground">
                  {activeHeaders.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-t border-border/40 row-hover">
                    {activeHeaders.map((h) => (
                      <td
                        key={h}
                        className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate"
                        title={row[h] ?? ""}
                      >
                        {row[h] || <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
          <button
            type="button"
            className="px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
            onClick={onCancel}
            disabled={importing}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Annuler
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)",
              boxShadow: "0 0 22px rgba(99, 102, 241, 0.35)",
            }}
            onClick={onConfirm}
            disabled={importing || activeCount === 0}
          >
            {importing ? "Import en cours…" : "Importer"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ColumnRow = ({
  col,
  onUpdate,
}: {
  col: ColumnConfig;
  onUpdate: (patch: Partial<ColumnConfig>) => void;
}) => (
  <div
    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
      col.active
        ? "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5"
        : "border-border/60 bg-background/30"
    }`}
  >
    <button
      type="button"
      onClick={() => onUpdate({ active: !col.active })}
      aria-pressed={col.active}
      title={
        col.active
          ? "Visible dans le bon de commande"
          : "Ignorée (ne sera pas importée)"
      }
      className="shrink-0 cursor-pointer"
    >
      {col.active ? (
        <ToggleRight className="w-7 h-7 text-[hsl(var(--success))]" />
      ) : (
        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
      )}
    </button>

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
  </div>
);

/* -------------------------------------------------------------------------- */
/*                             Sub components                                 */
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
  const title = vehiculeDisplayLabel(vehicule);
  const visibleEntries = vehicule.colonnes_pdf
    .map((k) => [k, vehicule.donnees[k] ?? ""] as const)
    .filter(([, v]) => v && v.trim() !== "");
  // On limite l'aperçu à 6 champs, sinon on a trop d'info sur chaque card.
  const preview = visibleEntries.slice(0, 6);
  const overflow = Math.max(0, visibleEntries.length - preview.length);

  return (
    <div
      className={`card-autodocs flex flex-col gap-3 interactive-lift ${
        vehicule.disponible ? "" : "opacity-70"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3
            className="font-display text-[14px] font-bold truncate leading-tight"
            title={title}
          >
            {title}
          </h3>
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

      <div className="grid grid-cols-1 gap-y-1 text-[12px]">
        {preview.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 max-w-[120px] truncate">
              {k}
            </span>
            <span className="text-foreground truncate min-w-0" title={v}>
              {v}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <div className="text-[10px] text-muted-foreground italic">
            + {overflow} autre(s)
          </div>
        )}
      </div>

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

export default StockVehicules;

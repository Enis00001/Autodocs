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
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [listQuery, setListQuery] = useState("");

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
    let list =
      filter === "disponibles"
        ? vehicules.filter((v) => v.disponible)
        : filter === "vendus"
          ? vehicules.filter((v) => !v.disponible)
          : vehicules;
    const q = listQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((v) => {
        const label = vehiculeDisplayLabel(v).toLowerCase();
        const blob = [label, ...Object.values(v.donnees)].join(" ").toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }, [vehicules, filter, listQuery]);

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
        subtitle="Import CSV/Excel & gestion du parc"
        actions={
          <>
            {!inImportFlow && vehicules.length > 0 && (
              <button type="button" className="btn-danger cursor-pointer" onClick={handleClear}>
                Vider le stock
              </button>
            )}
            {!inImportFlow && (
              <button
                type="button"
                className="btn-primary inline-flex cursor-pointer border-0"
                onClick={handleFilePick}
              >
                <Upload className="h-4 w-4" />
                Importer CSV/Excel
              </button>
            )}
            {inImportFlow && (
              <button
                type="button"
                className="btn-primary inline-flex cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="card-autodocs flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    className="field-input w-full pl-9"
                    placeholder="Rechercher marque, modèle, VIN, plaque…"
                    value={listQuery}
                    onChange={(e) => setListQuery(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["tous", "disponibles", "vendus"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={cn(
                        "cursor-pointer rounded-input border px-3 py-1.5 text-xs font-medium transition-all duration-200",
                        filter === f
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground",
                      )}
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
                      className="btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs md:ml-auto"
                      onClick={() => void refresh(concessionId)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rafraîchir
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="card-autodocs space-y-3">
                  <div className="skeleton h-32 w-full rounded-input" />
                  <div className="skeleton h-4 w-3/4 max-w-[200px] rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton h-3 w-2/3 rounded" />
                </div>
              ))}
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
    className={`card-autodocs flex flex-col items-center border-2 border-dashed py-8 text-center transition-colors md:py-12 ${
      dragActive
        ? "border-primary bg-primary/5"
        : "border-border/60 hover:border-muted-foreground/60"
    }`}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full gradient-primary md:h-16 md:w-16">
      <Upload className="h-7 w-7 text-primary-foreground md:h-8 md:w-8" />
    </div>
    <h2 className="mb-1 font-display text-base font-bold md:text-lg">
      <span className="hidden md:inline">Glissez votre fichier CSV ou Excel ici</span>
      <span className="md:hidden">Importer un fichier</span>
    </h2>
    <p className="mb-4 max-w-md px-2 text-sm text-muted-foreground">
      <span className="hidden md:inline">
        Formats acceptés : <span className="text-foreground">.csv, .xlsx, .xls</span>
        <br />
        Les noms de colonnes de votre fichier seront utilisés tels quels dans le
        bon de commande.
      </span>
      <span className="md:hidden">
        Formats : <span className="text-foreground">.csv, .xlsx, .xls</span>
      </span>
    </p>
    <button
      type="button"
      className="inline-flex w-full min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 px-4 py-2.5 text-[13px] font-medium text-primary-foreground gradient-primary transition-all hover:-translate-y-0.5 md:w-auto"
      onClick={onPick}
    >
      <FileSpreadsheet className="h-4 w-4" />
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
      className={cn(
        "card-autodocs flex flex-col gap-0 overflow-hidden interactive-lift p-0",
        !vehicule.disponible && "opacity-75",
      )}
    >
      <div className="relative flex h-36 items-center justify-center border-b border-border/50 bg-gradient-to-br from-secondary/80 to-background">
        <Car className="h-16 w-16 text-muted-foreground/25" strokeWidth={1.25} />
        <span
          className={cn(
            "absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
            vehicule.disponible
              ? "bg-success/20 text-success"
              : "bg-destructive/20 text-destructive",
          )}
        >
          {vehicule.disponible ? "Disponible" : "Vendu"}
        </span>
      </div>
      <div className="space-y-3 p-4">
      <div className="min-w-0">
          <h3
            className="font-display text-[15px] font-bold leading-tight text-foreground truncate"
            title={title}
          >
            {title}
          </h3>
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

      <div className="mt-auto flex flex-col gap-2 border-t border-border/40 pt-3 md:flex-row">
        {vehicule.disponible ? (
          <button
            type="button"
            className="btn-secondary w-full cursor-pointer border-success/40 py-2 text-xs font-semibold text-success hover:bg-success/10 md:flex-1"
            onClick={() => onMarkSold(vehicule.id)}
          >
            Marquer vendu
          </button>
        ) : (
          <div className="w-full rounded-input border border-border py-2 text-center text-xs text-muted-foreground md:flex-1">
            Vendu
          </div>
        )}
        <button
          type="button"
          className="btn-danger inline-flex w-full cursor-pointer items-center justify-center gap-1.5 py-2 text-xs md:w-auto md:px-3"
          onClick={() => onDelete(vehicule.id)}
          aria-label="Supprimer"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="md:hidden">Supprimer</span>
        </button>
      </div>
      </div>
    </div>
  );
};

export default StockVehicules;

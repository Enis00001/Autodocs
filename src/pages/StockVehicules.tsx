import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
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
  Plus,
  Pencil,
  FileText,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import { getCurrentConcessionId } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addVehicule,
  clearStock,
  deleteVehicule,
  formInputFromVehicule,
  importVehicules,
  loadStockVehicules,
  STATUT_LABELS,
  STATUTS_VEHICULE,
  stringifyCell,
  updateStatut,
  updateVehicule,
  vehiculeDisplayLabel,
  type StatutVehicule,
  type StockVehicule,
  type StockVehiculeInput,
  type VehiculeFormInput,
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

/** Filtre liste : vendu = indisponible ou statut explicite « vendu ». */
function isVenduListe(v: StockVehicule): boolean {
  return !v.disponible || v.statut === "vendu";
}

type ListeStockFilter = "tous" | "disponibles" | "vendus";

/* ------------------------------ helpers ------------------------------ */

const CARBURANT_OPTIONS = [
  "Essence",
  "Diesel",
  "Hybride",
  "Électrique",
  "GPL",
  "Autre",
];

const EMPTY_FORM_INPUT: VehiculeFormInput = {
  marque: "",
  modele: "",
  immatriculation: "",
  vin: "",
  annee: "",
  premiereCirculation: "",
  kilometrage: "",
  carburant: "",
  prix: "",
  statut: "disponible",
  notes: "",
};

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

function getImmatriculation(v: StockVehicule): string {
  const candidates = [
    "Immatriculation",
    "Immat",
    "Plaque",
    "immatriculation",
    "immat",
  ];
  for (const c of candidates) {
    const val = v.donnees[c];
    if (val && val.trim()) return val;
  }
  // fallback case-insensitive
  for (const [k, val] of Object.entries(v.donnees)) {
    if (!val) continue;
    const n = normalize(k);
    if (n === "immatriculation" || n === "immat" || n === "plaque") return val;
  }
  return "";
}

function getDonneesValue(
  donnees: Record<string, string>,
  candidates: string[],
): string {
  for (const c of candidates) {
    const val = donnees[c];
    if (val && val.trim()) return val.trim();
  }
  const normalizedCandidates = candidates.map((c) => normalize(c));
  for (const [k, val] of Object.entries(donnees)) {
    if (!val || !val.trim()) continue;
    if (normalizedCandidates.includes(normalize(k))) return val.trim();
  }
  return "";
}

function vehiculeMatchesQuery(v: StockVehicule, q: string): boolean {
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = normalize(
    [
      v.marque,
      v.modele,
      vehiculeDisplayLabel(v),
      getImmatriculation(v),
      // On élargit légèrement pour rester utile (modèle CSV sans typés).
      v.donnees["Marque"] ?? "",
      v.donnees["Modèle"] ?? v.donnees["Modele"] ?? "",
    ].join(" "),
  );
  return tokens.every((t) => haystack.includes(normalize(t)));
}

function formatPrix(prix: number | null, fallback?: string): string {
  if (typeof prix === "number" && Number.isFinite(prix)) {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(prix);
  }
  if (fallback && fallback.trim()) return fallback;
  return "—";
}

function formatKm(km: number | null, fallback?: string): string {
  if (typeof km === "number" && Number.isFinite(km)) {
    return `${new Intl.NumberFormat("fr-FR").format(km)} km`;
  }
  if (fallback && fallback.trim()) return fallback;
  return "—";
}

function statutBadgeClasses(statut: StatutVehicule): string {
  switch (statut) {
    case "disponible":
      return "bg-success/15 text-success border-success/40";
    case "réservé":
      return "bg-amber-500/15 text-amber-400 border-amber-500/40";
    case "vendu":
      return "bg-destructive/15 text-destructive border-destructive/40";
  }
}

function statutDotClasses(statut: StatutVehicule): string {
  switch (statut) {
    case "disponible":
      return "bg-success";
    case "réservé":
      return "bg-amber-400";
    case "vendu":
      return "bg-destructive";
  }
}

/* -------------------------------------------------------------------------- */

const StockVehicules = () => {
  const navigate = useNavigate();
  const [concessionId, setConcessionId] = useState<string | null>(null);
  const [vehicules, setVehicules] = useState<StockVehicule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ListeStockFilter>("tous");
  const [listQuery, setListQuery] = useState("");

  // CSV import flow (inchangé).
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [columns, setColumns] = useState<ColumnConfig[]>([]);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Add / Edit modal.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorTarget, setEditorTarget] = useState<StockVehicule | null>(null);

  // Delete confirm.
  const [deleteTarget, setDeleteTarget] = useState<StockVehicule | null>(null);

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
      const cid = await getCurrentConcessionId();
      setConcessionId(cid);
      if (cid) await refresh(cid);
      else setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const onStockUpdated = () => {
      void (async () => {
        const cid = await getCurrentConcessionId();
        if (cid) await refresh(cid);
      })();
    };
    window.addEventListener("autodocs_stock_updated", onStockUpdated);
    return () => window.removeEventListener("autodocs_stock_updated", onStockUpdated);
  }, []);

  /* ------------------------------ derived ------------------------------ */

  const stats = useMemo(() => {
    let disponibles = 0;
    let vendus = 0;
    for (const v of vehicules) {
      if (isVenduListe(v)) vendus++;
      else disponibles++;
    }
    return {
      tous: vehicules.length,
      disponibles,
      vendus,
    };
  }, [vehicules]);

  const filteredVehicules = useMemo(() => {
    let list = vehicules;
    if (filter === "disponibles") list = list.filter((v) => !isVenduListe(v));
    else if (filter === "vendus") list = list.filter((v) => isVenduListe(v));
    const q = normalize(listQuery);
    if (q) list = list.filter((v) => vehiculeMatchesQuery(v, q));
    return list;
  }, [vehicules, filter, listQuery]);

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

  /* ----------------------------- toggles (CSV) ----------------------------- */

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

  /* ---------------------------- confirmation CSV ---------------------------- */

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

    const toInsert: StockVehiculeInput[] = parsed.rows
      .filter((row) => activeHeaders.some((h) => (row[h] ?? "").trim() !== ""))
      .map((row) => ({
        donnees: row,
        colonnes_pdf: activeHeaders,
        statut: "disponible",
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

  const openCreate = () => {
    setEditorMode("create");
    setEditorTarget(null);
    setEditorOpen(true);
  };

  const openEdit = (v: StockVehicule) => {
    setEditorMode("edit");
    setEditorTarget(v);
    setEditorOpen(true);
  };

  const handleSaveVehicule = async (input: VehiculeFormInput) => {
    if (!concessionId) return;
    try {
      if (editorMode === "edit" && editorTarget) {
        const updated = await updateVehicule(editorTarget.id, input);
        setVehicules((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
        toast({ title: "Véhicule mis à jour" });
      } else {
        const created = await addVehicule(concessionId, input);
        setVehicules((prev) => [created, ...prev]);
        toast({ title: "Véhicule ajouté au stock" });
      }
      setEditorOpen(false);
    } catch (err) {
      toast({
        title: "Échec de la sauvegarde",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  const handleStatutChange = async (v: StockVehicule, statut: StatutVehicule) => {
    if (v.statut === statut) return;
    // Optimiste : on met à jour la liste tout de suite, on rollback en cas d'erreur.
    setVehicules((prev) =>
      prev.map((x) =>
        x.id === v.id ? { ...x, statut, disponible: statut === "disponible" } : x,
      ),
    );
    try {
      await updateStatut(v.id, statut);
    } catch (err) {
      setVehicules((prev) =>
        prev.map((x) =>
          x.id === v.id ? { ...x, statut: v.statut, disponible: v.disponible } : x,
        ),
      );
      toast({
        title: "Mise à jour impossible",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteVehicule(target.id);
      setVehicules((prev) => prev.filter((v) => v.id !== target.id));
      toast({ title: "Véhicule supprimé" });
    } catch (err) {
      toast({
        title: "Suppression impossible",
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

  const handleCreateBon = (v: StockVehicule) => {
    navigate(`/nouveau-bon?vehicleId=${encodeURIComponent(v.id)}`);
  };

  /* -------------------------------- render ----------------------------- */

  return (
    <>
      <TopBar
        title="Stock véhicules"
        subtitle="Catalogue des véhicules disponibles à la vente"
        actions={
          <>
            {!inImportFlow && vehicules.length > 0 && (
              <button
                type="button"
                className="btn-danger hidden cursor-pointer md:inline-flex"
                onClick={handleClear}
              >
                Vider le stock
              </button>
            )}
            {!inImportFlow && (
              <>
                <button
                  type="button"
                  className="btn-secondary hidden cursor-pointer sm:inline-flex"
                  onClick={handleFilePick}
                >
                  <Upload className="h-4 w-4" />
                  Importer CSV/Excel
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex cursor-pointer border-0"
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4" />
                  Ajouter un véhicule
                </button>
              </>
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
          {/* --- Import flow (inchangé) --- */}
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
            <EmptyStockState
              dragActive={dragActive}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onPick={handleFilePick}
              onAdd={openCreate}
            />
          )}

          {/* --- Liste --- */}
          {!inImportFlow && vehicules.length > 0 && (
            <>
              {/* Search + tabs */}
              <div className="card-autodocs space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="relative min-w-[200px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      className="field-input w-full pl-9"
                      placeholder="Rechercher marque, modèle, immatriculation…"
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                    />
                  </div>
                  {concessionId && (
                    <button
                      type="button"
                      className="btn-secondary inline-flex cursor-pointer items-center gap-1.5 px-3 py-2 text-xs"
                      onClick={() => void refresh(concessionId)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rafraîchir
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    Afficher : tous les véhicules, uniquement les disponibles, ou les vendus (badge rouge,
                    ligne grisée).
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <FilterPill
                      label="Tous"
                      count={stats.tous}
                      active={filter === "tous"}
                      onClick={() => setFilter("tous")}
                    />
                    <FilterPill
                      label="Disponibles"
                      count={stats.disponibles}
                      active={filter === "disponibles"}
                      onClick={() => setFilter("disponibles")}
                      tone="disponible"
                    />
                    <FilterPill
                      label="Vendus"
                      count={stats.vendus}
                      active={filter === "vendus"}
                      onClick={() => setFilter("vendus")}
                      tone="vendu"
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              <VehiculesTable
                vehicules={filteredVehicules}
                onStatutChange={handleStatutChange}
                onEdit={openEdit}
                onDelete={(v) => setDeleteTarget(v)}
                onCreateBon={handleCreateBon}
              />

              {filteredVehicules.length === 0 && (
                <div className="card-autodocs py-10 text-center text-sm text-muted-foreground">
                  Aucun véhicule ne correspond à ces filtres.
                </div>
              )}
            </>
          )}

          {loading && !inImportFlow && vehicules.length === 0 && (
            <div className="card-autodocs space-y-3">
              <div className="skeleton h-10 w-full rounded-input" />
              <div className="skeleton h-72 w-full rounded-input" />
            </div>
          )}
        </div>
      </div>

      {/* --- Modal Ajout / Édition --- */}
      <VehiculeFormDialog
        open={editorOpen}
        mode={editorMode}
        initial={editorTarget ? formInputFromVehicule(editorTarget) : EMPTY_FORM_INPUT}
        onClose={() => setEditorOpen(false)}
        onSubmit={handleSaveVehicule}
      />

      {/* --- Confirmation suppression --- */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce véhicule ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  <span className="font-semibold text-foreground">
                    {vehiculeDisplayLabel(deleteTarget)}
                  </span>{" "}
                  sera définitivement supprimé du stock. Cette action est
                  irréversible.
                </>
              ) : (
                "Cette action est irréversible."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleConfirmDelete()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Filter Pill                                   */
/* -------------------------------------------------------------------------- */

const FilterPill = ({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: StatutVehicule;
  onClick: () => void;
}) => {
  const base =
    "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 inline-flex items-center gap-2";
  if (active) {
    if (tone === "disponible") {
      return (
        <button type="button" onClick={onClick} className={cn(base, statutBadgeClasses("disponible"))}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statutDotClasses("disponible"))} />
          {label} <span className="opacity-80">({count})</span>
        </button>
      );
    }
    if (tone === "réservé") {
      return (
        <button type="button" onClick={onClick} className={cn(base, statutBadgeClasses("réservé"))}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statutDotClasses("réservé"))} />
          {label} <span className="opacity-80">({count})</span>
        </button>
      );
    }
    if (tone === "vendu") {
      return (
        <button type="button" onClick={onClick} className={cn(base, statutBadgeClasses("vendu"))}>
          <span className={cn("h-1.5 w-1.5 rounded-full", statutDotClasses("vendu"))} />
          {label} <span className="opacity-80">({count})</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, "border-primary bg-primary/10 text-primary")}
      >
        {label} <span className="opacity-80">({count})</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
      )}
    >
      {tone && (
        <span className={cn("h-1.5 w-1.5 rounded-full opacity-60", statutDotClasses(tone))} />
      )}
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
};

/* -------------------------------------------------------------------------- */
/*                              Empty state                                   */
/* -------------------------------------------------------------------------- */

const EmptyStockState = ({
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
  onAdd,
}: {
  dragActive: boolean;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: () => void;
  onAdd: () => void;
}) => (
  <div
    className={`card-autodocs flex flex-col items-center border-2 border-dashed py-10 text-center transition-colors md:py-14 ${
      dragActive
        ? "border-primary bg-primary/5"
        : "border-border/60 hover:border-muted-foreground/60"
    }`}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full gradient-primary md:h-16 md:w-16">
      <Car className="h-7 w-7 text-primary-foreground md:h-8 md:w-8" />
    </div>
    <h2 className="mb-1 font-display text-base font-bold md:text-lg">
      Aucun véhicule en stock
    </h2>
    <p className="mb-5 max-w-md px-2 text-sm text-muted-foreground">
      Ajoutez votre premier véhicule manuellement, ou importez un fichier CSV/Excel
      pour pré-remplir le stock en quelques secondes.
    </p>
    <div className="flex flex-col gap-2 sm:flex-row">
      <button type="button" className="btn-primary cursor-pointer" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        Ajouter un véhicule
      </button>
      <button
        type="button"
        className="btn-secondary cursor-pointer"
        onClick={onPick}
      >
        <FileSpreadsheet className="h-4 w-4" />
        Importer CSV/Excel
      </button>
    </div>
  </div>
);

/* -------------------------------------------------------------------------- */
/*                              Vehicules table                               */
/* -------------------------------------------------------------------------- */

const VehiculesTable = ({
  vehicules,
  onStatutChange,
  onEdit,
  onDelete,
  onCreateBon,
}: {
  vehicules: StockVehicule[];
  onStatutChange: (v: StockVehicule, statut: StatutVehicule) => void;
  onEdit: (v: StockVehicule) => void;
  onDelete: (v: StockVehicule) => void;
  onCreateBon: (v: StockVehicule) => void;
}) => (
  <div className="card-autodocs overflow-hidden p-0">
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-secondary/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">Véhicule</th>
            <th className="px-3 py-3 text-left font-semibold">Immat.</th>
            <th className="px-3 py-3 text-left font-semibold">Année</th>
            <th className="px-3 py-3 text-left font-semibold">Km</th>
            <th className="px-3 py-3 text-left font-semibold">Carburant</th>
            <th className="px-3 py-3 text-right font-semibold">Prix</th>
            <th className="px-3 py-3 text-left font-semibold">Statut</th>
            <th className="px-3 py-3 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {vehicules.map((v) => (
            <VehiculeRow
              key={v.id}
              vehicule={v}
              onStatutChange={onStatutChange}
              onEdit={onEdit}
              onDelete={onDelete}
              onCreateBon={onCreateBon}
            />
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const VehiculeRow = ({
  vehicule,
  onStatutChange,
  onEdit,
  onDelete,
  onCreateBon,
}: {
  vehicule: StockVehicule;
  onStatutChange: (v: StockVehicule, statut: StatutVehicule) => void;
  onEdit: (v: StockVehicule) => void;
  onDelete: (v: StockVehicule) => void;
  onCreateBon: (v: StockVehicule) => void;
}) => {
  const titleParts = [vehicule.marque, vehicule.modele]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const title = titleParts.length > 0 ? titleParts.join(" ") : vehiculeDisplayLabel(vehicule);
  const immat = getImmatriculation(vehicule);
  const annee =
    vehicule.annee !== null
      ? String(vehicule.annee)
      : getDonneesValue(vehicule.donnees, ["Année", "Annee", "annee", "ANNÉE"]) || "—";
  const km = formatKm(
    vehicule.kilometrage,
    getDonneesValue(vehicule.donnees, [
      "Kilométrage",
      "Kilometrage",
      "kilometrage",
      "Km",
      "KM",
      "km",
    ]),
  );
  const carb =
    vehicule.carburant?.trim() ||
    getDonneesValue(vehicule.donnees, [
      "Carburant",
      "carburant",
      "Énergie",
      "Energie",
      "energie",
    ]) ||
    "—";
  const prix = formatPrix(vehicule.prix, vehicule.donnees["Prix"]);

  const showVenduBadge = isVenduListe(vehicule);

  return (
    <tr
      className={cn(
        "border-t border-border/50 transition-colors",
        showVenduBadge
          ? "bg-muted/25 opacity-[0.72] hover:bg-muted/35"
          : "hover:bg-secondary/30",
      )}
    >
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn("font-medium", showVenduBadge ? "text-muted-foreground" : "text-foreground")}
          >
            {title}
          </div>
          {showVenduBadge ? (
            <span className="inline-flex shrink-0 rounded-full border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-destructive">
              Vendu
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-[12px] uppercase tracking-wider text-foreground">
        {immat || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-3 text-foreground">{annee || "—"}</td>
      <td className="px-3 py-3 text-foreground">{km}</td>
      <td className="px-3 py-3 text-foreground">{carb}</td>
      <td className="px-3 py-3 text-right font-semibold text-foreground">{prix}</td>
      <td className="px-3 py-3">
        <StatutDropdown
          statut={vehicule.statut}
          onChange={(s) => onStatutChange(vehicule, s)}
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {vehicule.statut === "disponible" && (
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/20"
              onClick={() => onCreateBon(vehicule)}
              title="Créer un bon de commande pour ce véhicule"
            >
              <FileText className="h-3.5 w-3.5" />
              <span className="hidden md:inline">Bon de commande</span>
              <span className="md:hidden">Bon</span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
            onClick={() => onEdit(vehicule)}
            title="Éditer"
            aria-label="Éditer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-destructive/40 p-1.5 text-destructive transition-colors hover:bg-destructive/10"
            onClick={() => onDelete(vehicule)}
            title="Supprimer"
            aria-label="Supprimer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
};

const StatutDropdown = ({
  statut,
  onChange,
}: {
  statut: StatutVehicule;
  onChange: (s: StatutVehicule) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
          statutBadgeClasses(statut),
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", statutDotClasses(statut))} />
        {STATUT_LABELS[statut]}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-[10rem]">
      {STATUTS_VEHICULE.map((s) => (
        <DropdownMenuItem
          key={s}
          className="cursor-pointer gap-2"
          onSelect={() => onChange(s)}
        >
          <span className={cn("h-2 w-2 rounded-full", statutDotClasses(s))} />
          {STATUT_LABELS[s]}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

/* -------------------------------------------------------------------------- */
/*                       Modal Ajout / Édition véhicule                       */
/* -------------------------------------------------------------------------- */

const VehiculeFormDialog = ({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: VehiculeFormInput;
  onClose: () => void;
  onSubmit: (input: VehiculeFormInput) => void | Promise<void>;
}) => {
  const [form, setForm] = useState<VehiculeFormInput>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof VehiculeFormInput, string>>>({});

  // Reset le formulaire à chaque (ré)ouverture du dialogue.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors({});
    }
  }, [open, initial]);

  const update = <K extends keyof VehiculeFormInput>(key: K, value: VehiculeFormInput[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.marque.trim()) next.marque = "Requis";
    if (!form.modele.trim()) next.modele = "Requis";
    if (!form.immatriculation.trim()) next.immatriculation = "Requis";
    if (!form.kilometrage.trim()) next.kilometrage = "Requis";
    if (!form.carburant.trim()) next.carburant = "Requis";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        ...form,
        immatriculation: form.immatriculation.toUpperCase().trim(),
        marque: form.marque.trim(),
        modele: form.modele.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Éditer le véhicule" : "Ajouter un véhicule"}
          </DialogTitle>
          <DialogDescription>
            Renseignez les informations du véhicule. Les champs marqués
            d'une étoile sont obligatoires.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField label="Marque" required error={errors.marque}>
              <input
                type="text"
                className={cn("field-input", errors.marque && "field-input-error")}
                value={form.marque}
                onChange={(e) => update("marque", e.target.value)}
                placeholder="ex: Renault"
                autoFocus
              />
            </FormField>
            <FormField label="Modèle" required error={errors.modele}>
              <input
                type="text"
                className={cn("field-input", errors.modele && "field-input-error")}
                value={form.modele}
                onChange={(e) => update("modele", e.target.value)}
                placeholder="ex: Clio V"
              />
            </FormField>

            <FormField
              label="Immatriculation"
              required
              error={errors.immatriculation}
            >
              <input
                type="text"
                className={cn(
                  "field-input uppercase tracking-wider",
                  errors.immatriculation && "field-input-error",
                )}
                value={form.immatriculation}
                onChange={(e) => update("immatriculation", e.target.value.toUpperCase())}
                placeholder="ex: AB-123-CD"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
            <FormField label="VIN">
              <input
                type="text"
                className="field-input"
                value={form.vin}
                onChange={(e) => update("vin", e.target.value)}
                placeholder="N° de châssis"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>

            <FormField label="Année">
              <input
                type="number"
                inputMode="numeric"
                min={1900}
                max={2100}
                className="field-input"
                value={form.annee}
                onChange={(e) => update("annee", e.target.value)}
                placeholder="ex: 2022"
              />
            </FormField>
            <FormField label="Date 1ère mise en circulation">
              <input
                type="text"
                className="field-input"
                value={form.premiereCirculation}
                onChange={(e) => update("premiereCirculation", e.target.value)}
                placeholder="JJ/MM/AAAA"
              />
            </FormField>

            <FormField
              label="Kilométrage"
              required
              error={errors.kilometrage}
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className={cn("field-input", errors.kilometrage && "field-input-error")}
                value={form.kilometrage}
                onChange={(e) => update("kilometrage", e.target.value)}
                placeholder="ex: 45000"
              />
            </FormField>
            <FormField
              label="Carburant"
              required
              error={errors.carburant}
            >
              <select
                className={cn("field-input", errors.carburant && "field-input-error")}
                value={form.carburant}
                onChange={(e) => update("carburant", e.target.value)}
              >
                <option value="">— Sélectionner —</option>
                {CARBURANT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Prix de vente (€)">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="field-input"
                value={form.prix}
                onChange={(e) => update("prix", e.target.value)}
                placeholder="ex: 14990"
              />
            </FormField>
            <FormField label="Statut">
              <select
                className="field-input"
                value={form.statut}
                onChange={(e) => update("statut", e.target.value as StatutVehicule)}
              >
                {STATUTS_VEHICULE.map((s) => (
                  <option key={s} value={s}>
                    {STATUT_LABELS[s]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Notes internes">
            <textarea
              className="field-input min-h-[88px] resize-y"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Visible uniquement dans le stock — non publié sur le bon de commande."
              rows={3}
            />
          </FormField>

          <DialogFooter className="gap-2 pt-2">
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
              className="btn-primary cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
            >
              {submitting
                ? "Sauvegarde…"
                : mode === "edit"
                  ? "Enregistrer"
                  : "Ajouter au stock"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const FormField = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="field-label flex items-center gap-1">
      {label}
      {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error && <span className="text-[11px] text-destructive">{error}</span>}
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

export default StockVehicules;

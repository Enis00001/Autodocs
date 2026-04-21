import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload, Car, Trash2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
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
  type StockField,
  type StockVehicule,
  type StockVehiculeInput,
} from "@/utils/stockVehicules";

const FIELD_LABELS: Record<StockField, string> = {
  marque: "Marque",
  modele: "Modèle",
  version: "Version",
  annee: "Année",
  couleur: "Couleur",
  kilometrage: "Kilométrage",
  prix: "Prix",
  vin: "VIN",
  puissance: "Puissance",
  co2: "CO₂",
  carburant: "Carburant",
  transmission: "Transmission",
  premiere_circulation: "1ère circulation",
};

const FIELD_ORDER: StockField[] = [
  "marque",
  "modele",
  "version",
  "annee",
  "prix",
  "kilometrage",
  "couleur",
  "vin",
  "puissance",
  "co2",
  "carburant",
  "transmission",
  "premiere_circulation",
];

type PreviewState = {
  fileName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  mapping: Partial<Record<StockField, string>>;
};

const StockVehicules = () => {
  const [concessionId, setConcessionId] = useState<string | null>(null);
  const [vehicules, setVehicules] = useState<StockVehicule[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<"tous" | "disponibles" | "vendus">("tous");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  /* ------------------------------- Import CSV/XLSX ----------------------------- */

  const handleFilePick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset pour pouvoir réimporter le même fichier
    if (!file) return;
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
      setPreview({
        fileName: file.name,
        headers,
        rows,
        mapping,
      });
      toast({
        title: "Fichier chargé ✓",
        description: `${rows.length} ligne(s) détectée(s) dans ${file.name}.`,
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

  const updateMapping = (field: StockField, sourceHeader: string) => {
    setPreview((prev) =>
      prev ? { ...prev, mapping: { ...prev.mapping, [field]: sourceHeader || undefined } } : prev,
    );
  };

  const handleConfirmImport = async () => {
    if (!preview || !concessionId) return;
    const toInsert: StockVehiculeInput[] = preview.rows
      .map((row) => mapRowToVehicule(row, preview.mapping))
      .filter(
        (v) =>
          (v.marque && v.marque.trim()) ||
          (v.modele && v.modele.trim()) ||
          (v.vin && v.vin.trim()),
      );
    if (toInsert.length === 0) {
      toast({
        title: "Aucune ligne valide",
        description: "Vérifiez le mapping : marque, modèle ou VIN doivent être renseignés.",
        variant: "destructive",
      });
      return;
    }
    setImporting(true);
    try {
      await importVehicules(concessionId, toInsert);
      toast({ title: `Import réussi ✓`, description: `${toInsert.length} véhicule(s) ajouté(s).` });
      setPreview(null);
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

  /* -------------------------------- Actions cards ------------------------------ */

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
      toast({ title: "Stock vidé ✓" });
    } catch (err) {
      toast({
        title: "Échec",
        description: err instanceof Error ? err.message : "Erreur Supabase.",
        variant: "destructive",
      });
    }
  };

  /* ----------------------------------- Render --------------------------------- */

  const previewSample = preview ? preview.rows.slice(0, 5) : [];

  return (
    <>
      <TopBar
        title="Stock véhicules"
        actions={
          <>
            {vehicules.length > 0 && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium border border-destructive/50 text-destructive hover:bg-destructive/10 transition-all bg-transparent cursor-pointer"
                onClick={handleClear}
              >
                Vider le stock
              </button>
            )}
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2"
              style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
              onClick={handleFilePick}
            >
              <Upload className="w-4 h-4" />
              Importer CSV/Excel
            </button>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label="Total stock" value={stats.total} accent="primary" />
            <StatCard label="Disponibles" value={stats.disponibles} accent="success" />
            <StatCard label="Vendus" value={stats.vendus} accent="muted" />
          </div>

          {/* --- Zone d'aperçu import --- */}
          {preview && (
            <div className="card-autodocs space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="card-title-autodocs">📥 Aperçu avant import</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Fichier : <span className="text-foreground">{preview.fileName}</span> •{" "}
                    {preview.rows.length} ligne(s) détectée(s)
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer"
                    onClick={() => setPreview(null)}
                    disabled={importing}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="px-3 py-2 rounded-lg text-xs font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={handleConfirmImport}
                    disabled={importing}
                  >
                    {importing ? "Import en cours..." : "Confirmer l'import"}
                  </button>
                </div>
              </div>

              {/* Mapping */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Mapping des colonnes détectées
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {FIELD_ORDER.map((field) => {
                    const detected = preview.mapping[field] ?? "";
                    return (
                      <div
                        key={field}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-2.5 py-2"
                      >
                        <label className="field-label shrink-0 w-28">
                          {FIELD_LABELS[field]}
                        </label>
                        <select
                          className="field-input flex-1 text-xs"
                          value={detected}
                          onChange={(e) => updateMapping(field, e.target.value)}
                        >
                          <option value="">— non importé —</option>
                          {preview.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        {detected ? (
                          <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))] shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview 5 premières lignes */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  5 premières lignes (après mapping)
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-[12px]">
                    <thead className="bg-secondary/50">
                      <tr className="text-left text-muted-foreground">
                        {FIELD_ORDER.map((f) => (
                          <th key={f} className="px-2 py-2 font-medium whitespace-nowrap">
                            {FIELD_LABELS[f]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewSample.map((row, i) => {
                        const mapped = mapRowToVehicule(row, preview.mapping);
                        return (
                          <tr
                            key={i}
                            className="border-t border-border/40 row-hover"
                          >
                            {FIELD_ORDER.map((f) => (
                              <td
                                key={f}
                                className="px-2 py-2 text-foreground whitespace-nowrap max-w-[180px] truncate"
                                title={String(mapped[f] ?? "")}
                              >
                                {String(mapped[f] ?? "") || (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* --- Zone vide (pas d'import en cours, pas de véhicules) --- */}
          {!preview && !loading && vehicules.length === 0 && (
            <div className="card-autodocs flex flex-col items-center text-center py-10">
              <div className="w-14 h-14 rounded-full gradient-primary flex items-center justify-center mb-3">
                <Car className="w-7 h-7 text-primary-foreground" />
              </div>
              <h2 className="font-display text-base font-bold mb-1">Aucun véhicule en stock</h2>
              <p className="text-sm text-muted-foreground max-w-md mb-4">
                Importez un fichier CSV ou Excel contenant votre catalogue véhicules. Les colonnes
                sont détectées automatiquement (marque, modèle, prix, VIN, couleur, km…).
              </p>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0 inline-flex items-center gap-2"
                onClick={handleFilePick}
              >
                <Upload className="w-4 h-4" />
                Importer un fichier
              </button>
            </div>
          )}

          {/* --- Liste --- */}
          {vehicules.length > 0 && (
            <>
              <div className="flex items-center gap-2">
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

          {loading && !preview && vehicules.length === 0 && (
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

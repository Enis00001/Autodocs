import { useEffect, useRef, useState } from "react";
import { Search, X, Check } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { getCurrentUserId } from "@/lib/auth";
import {
  searchVehicules,
  vehiculeDisplayLabel,
  guessPrixFromDonnees,
  type StockVehicule,
} from "@/utils/stockVehicules";

type VehiculeForm = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string };

type VehiculeVenteProps = {
  form: VehiculeForm;
  onChange: (patch: Partial<BonDraftData>) => void;
};

const VehiculeVente = ({ form, onChange }: VehiculeVenteProps) => {
  const [concessionId, setConcessionId] = useState<string | null>(null);
  const [stockQuery, setStockQuery] = useState("");
  const [stockSuggestions, setStockSuggestions] = useState<StockVehicule[]>([]);
  const [isStockSearching, setIsStockSearching] = useState(false);
  const [isStockDropdownOpen, setIsStockDropdownOpen] = useState(false);
  const stockWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    getCurrentUserId().then(setConcessionId);
  }, []);

  useEffect(() => {
    if (!concessionId) return;
    const q = stockQuery.trim();
    if (q.length < 1) {
      setStockSuggestions([]);
      setIsStockSearching(false);
      return;
    }
    setIsStockSearching(true);
    const handle = window.setTimeout(async () => {
      const results = await searchVehicules(concessionId, q);
      setStockSuggestions(results);
      setIsStockSearching(false);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [stockQuery, concessionId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!stockWrapperRef.current) return;
      if (!stockWrapperRef.current.contains(e.target as Node)) {
        setIsStockDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleSelectStockVehicule = (v: StockVehicule) => {
    setStockQuery("");
    setStockSuggestions([]);
    setIsStockDropdownOpen(false);
    // On snapshote la donnée du véhicule dans le brouillon : le PDF reste
    // régénérable plus tard même si le véhicule est vendu / supprimé.
    const donnees = { ...v.donnees };
    const colonnes = [...v.colonnes_pdf];
    const patch: Partial<BonDraftData> = {
      vehiculeStockId: v.id,
      stockDonnees: donnees,
      stockColonnes: colonnes,
    };
    // Pré-remplissage du prix de la section Règlement (heuristique).
    const guessedPrix = guessPrixFromDonnees(donnees);
    if (guessedPrix && !form.vehiculePrix) {
      patch.vehiculePrix = guessedPrix;
    }
    onChange(patch);
  };

  const handleDeselectStockVehicule = () => {
    onChange({
      vehiculeStockId: "",
      stockDonnees: {},
      stockColonnes: [],
    });
  };

  /** Met à jour la valeur d'une clé dans le snapshot (édition ligne par ligne). */
  const updateStockField = (key: string, value: string) => {
    onChange({
      stockDonnees: { ...form.stockDonnees, [key]: value },
    });
  };

  const handleToggleReprise = () => {
    const next = !form.repriseActive;
    if (next) {
      onChange({ repriseActive: true });
    } else {
      onChange({
        repriseActive: false,
        reprisePlaque: "",
        repriseMarque: "",
        repriseModele: "",
        repriseVin: "",
        reprisePremiereCirculation: "",
        repriseValeur: "",
      });
    }
  };

  const hasStockVehicule =
    form.vehiculeStockId ||
    (form.stockColonnes && form.stockColonnes.length > 0);

  // Titre du véhicule sélectionné : on reconstruit un pseudo-StockVehicule
  // minimal pour réutiliser `vehiculeDisplayLabel`.
  const selectedLabel = hasStockVehicule
    ? vehiculeDisplayLabel({
        id: form.vehiculeStockId,
        concession_id: null,
        donnees: form.stockDonnees,
        colonnes_pdf: form.stockColonnes,
        disponible: true,
        created_at: "",
      })
    : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="card-title-autodocs">Recherche & détails</span>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
          Stock
        </span>
      </div>

      {!hasStockVehicule && (
        <div
          ref={stockWrapperRef}
          className="relative rounded-input border border-border/70 bg-secondary/30 p-4"
        >
          <label className="field-label mb-2 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-primary" />
            Recherche stock
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              className="field-input h-12 w-full pl-11 text-sm font-medium"
              placeholder="Modèle, VIN, immatriculation, marque…"
              value={stockQuery}
              onChange={(e) => {
                setStockQuery(e.target.value);
                setIsStockDropdownOpen(true);
              }}
              onFocus={() => setIsStockDropdownOpen(true)}
            />
            {isStockDropdownOpen && stockQuery.trim() && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                {isStockSearching && stockSuggestions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Recherche…</div>
                )}
                {!isStockSearching && stockSuggestions.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Aucun véhicule trouvé dans le stock
                  </div>
                )}
                {stockSuggestions.map((v) => {
                  const label = vehiculeDisplayLabel(v);
                  const secondary = v.colonnes_pdf
                    .slice(3, 6)
                    .map((k) => v.donnees[k])
                    .filter(Boolean)
                    .join(" • ");
                  return (
                    <button
                      type="button"
                      key={v.id}
                      className="w-full cursor-pointer border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-secondary/80"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectStockVehicule(v);
                      }}
                    >
                      <div className="truncate text-sm font-medium">{label}</div>
                      {secondary && (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {secondary}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Tapez pour filtrer le stock, puis cliquez sur une ligne.
          </p>
        </div>
      )}

      {hasStockVehicule ? (
        <div className="space-y-4 rounded-card border-2 border-success/40 bg-gradient-to-b from-success/10 to-transparent p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="whitespace-nowrap rounded-full border border-success/40 bg-success/15 px-2 py-1 text-[11px] font-bold text-success">
                Véhicule sélectionné
              </span>
              <span className="truncate text-sm font-semibold text-foreground" title={selectedLabel}>
                {selectedLabel || "—"}
              </span>
            </div>
            <button
              type="button"
              className="btn-secondary cursor-pointer gap-1.5 px-2.5 py-1.5 text-xs"
              onClick={handleDeselectStockVehicule}
            >
              <X className="h-3.5 w-3.5" />
              Désélectionner
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {form.stockColonnes.map((key) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="field-label truncate" title={key}>
                  {key}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    className="field-input pr-14"
                    value={form.stockDonnees[key] ?? ""}
                    onChange={(e) => updateStockField(key, e.target.value)}
                    placeholder="—"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">
                    Stock
                  </span>
                </div>
              </div>
            ))}
            {form.stockColonnes.length === 0 && (
              <div className="col-span-full text-xs italic text-muted-foreground">
                Aucune colonne activée à l&apos;import.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-input border border-dashed border-border/60 bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun véhicule sélectionné. Utilisez la recherche pour choisir un véhicule du
          stock.
        </div>
      )}

      {/* --- Sous-section Reprise véhicule --- */}
      <div className="mt-6 pt-5 border-t border-border/40">
        <button
          type="button"
          onClick={handleToggleReprise}
          aria-pressed={form.repriseActive}
          className={`w-full rounded-lg border-2 p-3.5 flex items-center justify-between gap-4 transition-colors ${
            form.repriseActive
              ? "border-[hsl(var(--success))]/60 bg-[hsl(var(--success))]/10 hover:bg-[hsl(var(--success))]/15"
              : "border-[hsl(var(--destructive))]/60 bg-[hsl(var(--destructive))]/10 hover:bg-[hsl(var(--destructive))]/15"
          }`}
        >
          <span className="flex items-center gap-3 min-w-0 text-left">
            <span
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                form.repriseActive
                  ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]"
                  : "bg-[hsl(var(--destructive))]/20 text-[hsl(var(--destructive))]"
              }`}
            >
              {form.repriseActive ? (
                <Check className="w-5 h-5" />
              ) : (
                <X className="w-5 h-5" />
              )}
            </span>
            <span className="flex flex-col min-w-0">
              <span
                className={`text-sm font-semibold ${
                  form.repriseActive
                    ? "text-[hsl(var(--success))]"
                    : "text-[hsl(var(--destructive))]"
                }`}
              >
                {form.repriseActive ? "Reprise d'un véhicule" : "Pas de reprise"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {form.repriseActive
                  ? "Un ancien véhicule est déduit du prix de vente"
                  : "Le client n'a pas de véhicule à céder"}
              </span>
            </span>
          </span>

          <span
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
              form.repriseActive
                ? "bg-[hsl(var(--success))]"
                : "bg-[hsl(var(--destructive))]"
            }`}
            aria-hidden
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                form.repriseActive ? "left-[26px]" : "left-0.5"
              }`}
            />
          </span>
        </button>

        {form.repriseActive && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Plaque d'immatriculation</label>
              <input
                type="text"
                placeholder="ex: AB-123-CD"
                className="field-input uppercase tracking-wider"
                value={form.reprisePlaque}
                onChange={(e) => onChange({ reprisePlaque: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Marque</label>
              <input
                type="text"
                placeholder="ex: Renault"
                className="field-input"
                value={form.repriseMarque}
                onChange={(e) => onChange({ repriseMarque: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Modèle</label>
              <input
                type="text"
                placeholder="ex: Clio IV Estate"
                className="field-input"
                value={form.repriseModele}
                onChange={(e) => onChange({ repriseModele: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">VIN / N° de châssis</label>
              <input
                type="text"
                placeholder="ex: VF1RFD00854..."
                className="field-input"
                value={form.repriseVin}
                onChange={(e) => onChange({ repriseVin: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label">Première mise en circulation</label>
              <input
                type="text"
                placeholder="ex: 21/07/2016"
                className="field-input"
                value={form.reprisePremiereCirculation}
                onChange={(e) =>
                  onChange({ reprisePremiereCirculation: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label flex items-center gap-1.5">
                <span className="text-[hsl(var(--success))]">●</span>
                Valeur de reprise (€)
                <span className="text-[10px] font-normal text-muted-foreground ml-auto">
                  Requis
                </span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="ex: 3 500"
                className="field-input text-base font-semibold"
                value={form.repriseValeur}
                onChange={(e) => onChange({ repriseValeur: e.target.value })}
              />
              <p className="text-[11px] text-muted-foreground">
                Montant déduit du prix de vente sur le bon de commande.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VehiculeVente;

import { useEffect, useRef, useState } from "react";
import { Search, X, Check } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { getCurrentUserId } from "@/lib/auth";
import {
  searchVehicules,
  vehiculeLabel,
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
  const [selectedStock, setSelectedStock] = useState<StockVehicule | null>(null);
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
    setSelectedStock(v);
    setStockQuery("");
    setStockSuggestions([]);
    setIsStockDropdownOpen(false);
    onChange({
      vehiculeModele: vehiculeLabel(v),
      vehiculePrix: v.prix ?? "",
      vehiculeVin: v.vin ?? "",
      vehiculeKilometrage: v.kilometrage ?? "",
      vehiculeCouleur: v.couleur ?? "",
      vehiculeChevaux: v.puissance ?? "",
      vehiculeCo2: v.co2 ?? "",
      vehiculePremiereCirculation: v.premiere_circulation ?? "",
    });
  };

  const handleDeselectStockVehicule = () => setSelectedStock(null);

  // --- Reprise véhicule : formulaire manuel --------------------------------
  const handleToggleReprise = () => {
    const next = !form.repriseActive;
    onChange({ repriseActive: next });
    if (!next) {
      // OFF → on vide tout pour éviter qu'un ancien brouillon pollue le PDF.
      onChange({
        reprisePlaque: "",
        repriseMarque: "",
        repriseModele: "",
        repriseVin: "",
        reprisePremiereCirculation: "",
        repriseValeur: "",
      });
    }
  };

  return (
    <div className="card-autodocs">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">🚗 Véhicule</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-primary/15 text-primary">
          Depuis stock
        </span>
      </div>

      {/* --- Recherche stock --- */}
      <div
        ref={stockWrapperRef}
        className="relative mb-5 rounded-lg border border-border/60 bg-background/30 p-3"
      >
        {selectedStock ? (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full font-semibold bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] whitespace-nowrap">
                ✓ Véhicule sélectionné
              </span>
              <span className="text-sm font-medium truncate" title={vehiculeLabel(selectedStock)}>
                {vehiculeLabel(selectedStock) || "—"}
              </span>
              {selectedStock.annee && (
                <span className="text-xs text-muted-foreground">({selectedStock.annee})</span>
              )}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
              onClick={handleDeselectStockVehicule}
            >
              <X className="w-3.5 h-3.5" />
              Désélectionner
            </button>
          </div>
        ) : (
          <>
            <label className="field-label flex items-center gap-1.5 mb-1.5">
              <Search className="w-3.5 h-3.5" />
              Rechercher un véhicule dans le stock
            </label>
            <div className="relative">
              <input
                type="text"
                className="field-input w-full"
                placeholder="ex: Peugeot 308, Clio IV, VIN…"
                value={stockQuery}
                onChange={(e) => {
                  setStockQuery(e.target.value);
                  setIsStockDropdownOpen(true);
                }}
                onFocus={() => setIsStockDropdownOpen(true)}
              />
              {isStockDropdownOpen && stockQuery.trim() && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg z-30">
                  {isStockSearching && stockSuggestions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Recherche…</div>
                  )}
                  {!isStockSearching && stockSuggestions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Aucun véhicule trouvé dans le stock
                    </div>
                  )}
                  {stockSuggestions.map((v) => (
                    <button
                      type="button"
                      key={v.id}
                      className="w-full text-left px-3 py-2 hover:bg-secondary/80 transition-colors border-b border-border/40 last:border-b-0 cursor-pointer"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectStockVehicule(v);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">
                          {vehiculeLabel(v) || "—"}
                        </span>
                        {v.prix && (
                          <span className="text-xs font-semibold text-primary whitespace-nowrap">
                            {v.prix} €
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                        {v.annee && <span>{v.annee}</span>}
                        {v.kilometrage && <span>• {v.kilometrage} km</span>}
                        {v.couleur && <span>• {v.couleur}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Aucune sélection : les champs ci-dessous restent éditables manuellement.
            </p>
          </>
        )}
      </div>

      {/* --- Champs véhicule --- */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="field-label">Modèle du véhicule</label>
          <input
            type="text"
            placeholder="ex: Peugeot 308 GT Pack"
            className="field-input"
            value={form.vehiculeModele}
            onChange={(e) => onChange({ vehiculeModele: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="field-label">VIN / N° de châssis</label>
          <input
            type="text"
            placeholder="ex: VF3LCYHZ..."
            className="field-input"
            value={form.vehiculeVin}
            onChange={(e) => onChange({ vehiculeVin: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">1ère mise en circulation</label>
          <input
            type="text"
            placeholder="ex: 03/2022"
            className="field-input"
            value={form.vehiculePremiereCirculation}
            onChange={(e) => onChange({ vehiculePremiereCirculation: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Kilométrage</label>
          <input
            type="text"
            placeholder="ex: 45 000"
            className="field-input"
            value={form.vehiculeKilometrage}
            onChange={(e) => onChange({ vehiculeKilometrage: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Puissance (CV)</label>
          <input
            type="text"
            placeholder="ex: 130"
            className="field-input"
            value={form.vehiculeChevaux}
            onChange={(e) => onChange({ vehiculeChevaux: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Émission CO2 (g/km)</label>
          <input
            type="text"
            placeholder="ex: 112"
            className="field-input"
            value={form.vehiculeCo2}
            onChange={(e) => onChange({ vehiculeCo2: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Couleur</label>
          <input
            type="text"
            placeholder="ex: Blanc Nacré"
            className="field-input"
            value={form.vehiculeCouleur}
            onChange={(e) => onChange({ vehiculeCouleur: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Prix de vente TTC (€)</label>
          <input
            type="text"
            placeholder="ex: 22 990"
            className="field-input"
            value={form.vehiculePrix}
            onChange={(e) => onChange({ vehiculePrix: e.target.value })}
          />
        </div>
      </div>

      {/* --- Sous-section Reprise véhicule --- */}
      <div className="mt-6 pt-5 border-t border-border/40">
        {/* Toggle ON/OFF — rouge (pas de reprise) / vert (reprise active) */}
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

          {/* switch pill */}
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

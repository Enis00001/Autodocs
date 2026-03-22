import { useEffect, useMemo, useState } from "react";
import type { BonDraftData, OptionDetail } from "@/utils/drafts";
import { loadVendeurs } from "@/utils/vendeurs";
import type { Vendeur } from "@/utils/vendeurs";

const FINANCEMENT_OPTIONS = ["Comptant", "Crédit classique", "LOA", "LLD"] as const;

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Sous-ensemble du brouillon utilisé par le formulaire (sans id/createdAt/updatedAt) */
type VehiculeForm = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & { id?: string };

type VehiculeVenteProps = {
  form: VehiculeForm;
  onChange: (patch: Partial<BonDraftData>) => void;
};

const VehiculeVente = ({ form, onChange }: VehiculeVenteProps) => {
  const [vendeurs, setVendeurs] = useState<Vendeur[]>([]);
  const [isLoadingVendeurs, setIsLoadingVendeurs] = useState(true);

  useEffect(() => {
    loadVendeurs()
      .then(setVendeurs)
      .finally(() => setIsLoadingVendeurs(false));
  }, []);
  const isComptant = form.vehiculeFinancement === "Comptant";
  const isCredit = form.vehiculeFinancement === "Crédit classique";
  const isLoaLld = form.vehiculeFinancement === "LOA" || form.vehiculeFinancement === "LLD";

  const optionsMode = form.optionsMode ?? "total";
  const optionsDetailList: OptionDetail[] = useMemo(() => {
    try {
      const parsed = JSON.parse(form.optionsDetailJson || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [form.optionsDetailJson]);

  const optionsTotalValue = useMemo(() => {
    if (optionsMode === "total") return parseNum(form.optionsPrixTotal);
    return optionsDetailList.reduce((sum, o) => sum + parseNum(o.price), 0);
  }, [optionsMode, form.optionsPrixTotal, optionsDetailList]);

  const totalFinal = useMemo(() => {
    const prix = parseNum(form.vehiculePrix);
    const carteGrise = parseNum(form.vehiculeCarteGrise);
    const fraisReprise = parseNum(form.vehiculeFraisReprise);
    const remise = parseNum(form.vehiculeRemise);
    return Math.max(0, prix + optionsTotalValue + carteGrise + fraisReprise - remise);
  }, [form.vehiculePrix, form.vehiculeCarteGrise, form.vehiculeFraisReprise, form.vehiculeRemise, optionsTotalValue]);

  const soldeRestantDu = useMemo(() => {
    if (!isComptant) return 0;
    return Math.max(0, totalFinal - parseNum(form.acompte));
  }, [isComptant, totalFinal, form.acompte]);

  const setOptionsDetailList = (list: OptionDetail[]) => {
    onChange({ optionsDetailJson: JSON.stringify(list) });
  };

  const addOptionDetail = () => {
    setOptionsDetailList([...optionsDetailList, { name: "", price: "" }]);
  };

  const updateOptionDetail = (index: number, field: "name" | "price", value: string) => {
    const next = [...optionsDetailList];
    next[index] = { ...next[index], [field]: value };
    setOptionsDetailList(next);
  };

  const removeOptionDetail = (index: number) => {
    setOptionsDetailList(optionsDetailList.filter((_, i) => i !== index));
  };

  return (
    <div className="card-autodocs">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">🚗 Véhicule & vente</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-primary/15 text-primary">
          Saisie vendeur
        </span>
      </div>

      <div className="space-y-6">
        {/* SECTION 1 — Infos du véhicule */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Infos du véhicule
          </h3>
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
              <label className="field-label">Numéro d'identification VIN / N° de châssis</label>
              <input
                type="text"
                placeholder="ex: VF3LCYHZ..."
                className="field-input"
                value={form.vehiculeVin}
                onChange={(e) => onChange({ vehiculeVin: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Mois & année 1ère mise en circulation</label>
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
              <label className="field-label">Nombre de chevaux (CV)</label>
              <input
                type="text"
                placeholder="ex: 130"
                className="field-input"
                value={form.vehiculeChevaux}
                onChange={(e) => onChange({ vehiculeChevaux: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* SECTION 2 — Prix & coûts */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Prix & coûts
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Prix de vente TTC (€)</label>
              <input
                type="text"
                placeholder="32 900"
                className="field-input"
                value={form.vehiculePrix}
                onChange={(e) => onChange({ vehiculePrix: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label">Options incluses</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    optionsMode === "total"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                  onClick={() => onChange({ optionsMode: "total" })}
                >
                  Prix total des options (€)
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                    optionsMode === "detail"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground"
                  }`}
                  onClick={() => onChange({ optionsMode: "detail" })}
                >
                  Détailler les options
                </button>
              </div>
              {optionsMode === "total" ? (
                <input
                  type="text"
                  placeholder="0"
                  className="field-input"
                  value={form.optionsPrixTotal}
                  onChange={(e) => onChange({ optionsPrixTotal: e.target.value })}
                />
              ) : (
                <div className="space-y-2">
                  {optionsDetailList.map((opt, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Nom option"
                        className="field-input flex-1"
                        value={opt.name}
                        onChange={(e) => updateOptionDetail(i, "name", e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Prix (€)"
                        className="field-input w-24"
                        value={opt.price}
                        onChange={(e) => updateOptionDetail(i, "price", e.target.value)}
                      />
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive text-sm cursor-pointer"
                        onClick={() => removeOptionDetail(i)}
                        aria-label="Supprimer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline cursor-pointer"
                    onClick={addOptionDetail}
                  >
                    + Ajouter une option
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Coût de la carte grise (€)</label>
              <input
                type="text"
                placeholder="0"
                className="field-input"
                value={form.vehiculeCarteGrise}
                onChange={(e) => onChange({ vehiculeCarteGrise: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Frais de reprise (€)</label>
              <input
                type="text"
                placeholder="0"
                className="field-input"
                value={form.vehiculeFraisReprise}
                onChange={(e) => onChange({ vehiculeFraisReprise: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Remise accordée (€)</label>
              <input
                type="text"
                placeholder="0"
                className="field-input"
                value={form.vehiculeRemise}
                onChange={(e) => onChange({ vehiculeRemise: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Total final à payer TTC (€)</label>
              <div className="field-input bg-muted/50 font-semibold">
                {totalFinal.toLocaleString("fr-FR")}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3 — Type de financement (choix) */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Type de financement
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label">Type de financement</label>
              <select
                className="field-input"
                value={form.vehiculeFinancement}
                onChange={(e) => onChange({ vehiculeFinancement: e.target.value })}
              >
                {FINANCEMENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* SECTION 3 — Modalités de paiement (dynamique) */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Modalités de paiement
          </h3>

          {isComptant && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Montant d'acompte (€)</label>
                <input
                  type="text"
                  placeholder="0"
                  className="field-input"
                  value={form.acompte}
                  onChange={(e) => onChange({ acompte: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Solde restant dû (€)</label>
                <div className="field-input bg-muted/50 font-semibold">
                  {soldeRestantDu.toLocaleString("fr-FR")}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 col-span-2">
                <label className="field-label">Mode de paiement</label>
                <div className="flex gap-2">
                  {(["virement", "cheque", "cb"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                        (form.modePaiement ?? "virement") === mode
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}
                      onClick={() => onChange({ modePaiement: mode as "virement" | "cheque" | "cb" })}
                    >
                      {mode === "virement" ? "Virement" : mode === "cheque" ? "Chèque de banque" : "CB"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(isCredit || isLoaLld) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Montant de l'apport (€)</label>
                <input
                  type="text"
                  placeholder="0"
                  className="field-input"
                  value={form.apport}
                  onChange={(e) => onChange({ apport: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Organisme prêteur</label>
                <input
                  type="text"
                  placeholder="ex: Banque XY"
                  className="field-input"
                  value={form.organismePreteur}
                  onChange={(e) => onChange({ organismePreteur: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Montant total du crédit (€)</label>
                <input
                  type="text"
                  placeholder="0"
                  className="field-input"
                  value={form.montantCredit}
                  onChange={(e) => onChange({ montantCredit: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Taux (%)</label>
                <input
                  type="text"
                  placeholder="ex: 3.5"
                  className="field-input"
                  value={form.tauxCredit}
                  onChange={(e) => onChange({ tauxCredit: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Durée (mois)</label>
                <input
                  type="text"
                  placeholder="ex: 48"
                  className="field-input"
                  value={form.dureeMois}
                  onChange={(e) => onChange({ dureeMois: e.target.value })}
                />
              </div>
              {isCredit && (
                <div className="flex flex-col gap-1.5 col-span-2 flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.clauseSuspensive ?? false}
                      onChange={(e) => onChange({ clauseSuspensive: e.target.checked })}
                      className="rounded border-border"
                    />
                    <span className="text-sm">Clause suspensive d'octroi de crédit 14 jours</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {!isComptant && !isCredit && !isLoaLld && (
            <p className="text-sm text-muted-foreground">Sélectionnez un type de financement ci-dessus.</p>
          )}
        </div>

        {/* Date livraison, reprise, couleur, vendeur */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Livraison & vendeur
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Date de livraison</label>
              <input
                type="text"
                placeholder="jj/mm/aaaa"
                className="field-input"
                value={form.vehiculeDateLivraison}
                onChange={(e) => onChange({ vehiculeDateLivraison: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Reprise véhicule (€)</label>
              <input
                type="text"
                placeholder="0 (aucune)"
                className="field-input"
                value={form.vehiculeReprise}
                onChange={(e) => onChange({ vehiculeReprise: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Couleur / finition</label>
              <input
                type="text"
                placeholder="ex: Blanc Nacré"
                className="field-input"
                value={form.vehiculeCouleur}
                onChange={(e) => onChange({ vehiculeCouleur: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Vendeur</label>
              <select
                className="field-input"
                value={form.vendeurNom}
                onChange={(e) => onChange({ vendeurNom: e.target.value })}
              >
                <option value="">Sélectionner un vendeur</option>
                {vendeurs.map((v) => {
                  const label = `${v.prenom} ${v.nom}`.trim() || v.id;
                  return (
                    <option key={v.id} value={label}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {!isLoadingVendeurs && vendeurs.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Aucun vendeur configuré — ajoutez des vendeurs dans les Paramètres
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 col-span-2">
              <label className="field-label">Notes vendeur</label>
              <input
                type="text"
                placeholder="Informations complémentaires..."
                className="field-input"
                value={form.vendeurNotes}
                onChange={(e) => onChange({ vendeurNotes: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehiculeVente;

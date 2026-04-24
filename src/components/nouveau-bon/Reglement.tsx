import { useMemo } from "react";
import { Wallet, Landmark } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import {
  DEFAULT_FORM_PREFS,
  getCustomFieldsBySection,
  isFieldEnabled,
  type FormFieldPrefs,
} from "@/utils/formPreferences";

type ReglementProps = {
  form: Pick<
    BonDraftData,
    | "modePaiement"
    | "acompte"
    | "vehiculeRemise"
    | "vehiculeDateLivraison"
    | "vehiculePrix"
    | "repriseActive"
    | "repriseValeur"
  >;
  onChange: (patch: Partial<BonDraftData>) => void;
  prefs?: FormFieldPrefs;
  customValues?: Record<string, string>;
  onCustomFieldChange?: (key: string, value: string) => void;
};

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const formatEur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Reglement = ({
  form,
  onChange,
  prefs = DEFAULT_FORM_PREFS,
  customValues = {},
  onCustomFieldChange,
}: ReglementProps) => {
  const { prix, remise, reprise, netAPayer, acompte, solde } = useMemo(() => {
    const prix = parseNum(form.vehiculePrix);
    const remise = parseNum(form.vehiculeRemise);
    const reprise = form.repriseActive ? parseNum(form.repriseValeur) : 0;
    const netAPayer = Math.max(0, prix - remise - reprise);
    const acompte = parseNum(form.acompte);
    const solde = Math.max(0, netAPayer - acompte);
    return { prix, remise, reprise, netAPayer, acompte, solde };
  }, [form.vehiculePrix, form.vehiculeRemise, form.repriseActive, form.repriseValeur, form.acompte]);

  const modes: Array<{ id: BonDraftData["modePaiement"]; label: string; icon: typeof Wallet }> = [
    { id: "comptant", label: "Comptant", icon: Wallet },
    { id: "financement", label: "Financement", icon: Landmark },
  ];
  const customFields = getCustomFieldsBySection(prefs, "reglement");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="card-title-autodocs">Détail du règlement</span>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
          Calcul auto
        </span>
      </div>

      {/* Mode de paiement */}
      {isFieldEnabled(prefs, "modePaiement") && (
      <div>
        <label className="field-label mb-2 block">Mode de paiement</label>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(({ id, label, icon: Icon }) => {
            const active = form.modePaiement === id;
            return (
              <button
                key={id}
                type="button"
                className={`flex items-center justify-center gap-2 rounded-input px-3 py-2.5 text-sm font-medium border transition-all duration-200 cursor-pointer ${
                  active
                    ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                    : "border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onChange({ modePaiement: id })}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* Montants */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {isFieldEnabled(prefs, "vehiculePrix") && (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label flex items-center gap-1.5">
            <span className="text-primary">●</span>
            Prix du véhicule (€)
            <span className="text-[10px] font-normal text-muted-foreground ml-auto">
              Requis
            </span>
          </label>
          <input
            type="text"
            inputMode="numeric"
            placeholder="ex: 12 500"
            className="field-input text-base font-semibold"
            value={form.vehiculePrix}
            onChange={(e) => onChange({ vehiculePrix: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground">
            Pré-rempli depuis le stock si une colonne « Prix » est détectée.
          </p>
        </div>
        )}
        {isFieldEnabled(prefs, "vehiculeRemise") && (
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
        )}
        {isFieldEnabled(prefs, "acompte") && (
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Acompte versé (€)</label>
          <input
            type="text"
            placeholder="0"
            className="field-input"
            value={form.acompte}
            onChange={(e) => onChange({ acompte: e.target.value })}
          />
        </div>
        )}
        {isFieldEnabled(prefs, "vehiculeDateLivraison") && (
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label">Date de livraison prévue</label>
          <input
            type="text"
            placeholder="jj/mm/aaaa"
            className="field-input"
            value={form.vehiculeDateLivraison}
            onChange={(e) => onChange({ vehiculeDateLivraison: e.target.value })}
          />
        </div>
        )}
        {customFields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5 md:col-span-2">
            <label className="field-label">{field.label}</label>
            <input
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              placeholder="—"
              className="field-input"
              value={customValues[field.key] ?? ""}
              onChange={(e) => onCustomFieldChange?.(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      {/* Récapitulatif */}
      <div className="rounded-input border border-border/60 bg-secondary/30 p-4 text-[13px]">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">Prix véhicule</span>
          <span className="font-medium">{formatEur(prix)} €</span>
        </div>
        {remise > 0 && (
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">Remise</span>
            <span className="font-medium text-destructive">- {formatEur(remise)} €</span>
          </div>
        )}
        {form.repriseActive && reprise > 0 && (
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">Reprise</span>
            <span className="font-medium text-destructive">- {formatEur(reprise)} €</span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5 border-t border-border/60 mt-1">
          <span className="font-semibold">Net à payer</span>
          <span className="font-semibold text-primary">{formatEur(netAPayer)} €</span>
        </div>
        {acompte > 0 && (
          <>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Acompte versé</span>
              <span className="font-medium">- {formatEur(acompte)} €</span>
            </div>
            <div className="flex items-center justify-between py-1.5 border-t border-border/60 mt-1">
              <span className="font-semibold">Solde restant dû</span>
              <span className="font-semibold">{formatEur(solde)} €</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Reglement;

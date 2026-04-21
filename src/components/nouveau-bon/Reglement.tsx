import { useMemo } from "react";
import { Wallet, Landmark } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";

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
};

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const formatEur = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Reglement = ({ form, onChange }: ReglementProps) => {
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

  return (
    <div className="card-autodocs">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">💳 Règlement</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-primary/15 text-primary">
          Calcul auto
        </span>
      </div>

      {/* Mode de paiement */}
      <div className="mb-5">
        <label className="field-label mb-2 block">Mode de paiement</label>
        <div className="grid grid-cols-2 gap-2">
          {modes.map(({ id, label, icon: Icon }) => {
            const active = form.modePaiement === id;
            return (
              <button
                key={id}
                type="button"
                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors cursor-pointer ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
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

      {/* Montants */}
      <div className="grid grid-cols-2 gap-3 mb-5">
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
          <label className="field-label">Acompte versé (€)</label>
          <input
            type="text"
            placeholder="0"
            className="field-input"
            value={form.acompte}
            onChange={(e) => onChange({ acompte: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="field-label">Date de livraison prévue</label>
          <input
            type="text"
            placeholder="jj/mm/aaaa"
            className="field-input"
            value={form.vehiculeDateLivraison}
            onChange={(e) => onChange({ vehiculeDateLivraison: e.target.value })}
          />
        </div>
      </div>

      {/* Récapitulatif */}
      <div className="rounded-lg border border-border/60 bg-background/30 p-3 text-[13px]">
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

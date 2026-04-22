import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Sparkles, Zap, Check, ArrowRight } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  loadAbonnement,
  startCheckout,
  QUOTA_GRATUIT,
  type AbonnementInfo,
} from "@/utils/abonnement";
import { cn } from "@/lib/utils";

const Abonnement = () => {
  const [info, setInfo] = useState<AbonnementInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await loadAbonnement();
      setInfo(data);
      setLoading(false);
    })();
  }, []);

  // Feedback retour Stripe
  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "success") {
      toast({
        title: "Merci !",
        description: "Votre abonnement Pro est en cours d'activation.",
      });
      searchParams.delete("status");
      setSearchParams(searchParams, { replace: true });
    } else if (status === "cancel") {
      toast({
        title: "Paiement annulé",
        description: "Vous pouvez reprendre quand vous voulez.",
      });
      searchParams.delete("status");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleUpgrade = async () => {
    setSubmitting(true);
    try {
      await startCheckout();
    } catch (err) {
      toast({
        title: "Paiement indisponible",
        description: err instanceof Error ? err.message : "Réessayez plus tard.",
        variant: "destructive",
      });
      setSubmitting(false);
    }
  };

  const plan = info?.plan ?? "gratuit";
  const isPro = plan === "pro";
  const bons = info?.bonsCeMois ?? 0;
  const percent = Math.min(100, (bons / QUOTA_GRATUIT) * 100);
  const renewal = info?.dateRenouvellement
    ? new Date(info.dateRenouvellement).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <>
      <TopBar title="Abonnement" subtitle="Plan, quota et facturation" />
      <div className="page-shell">
        <div className="page-content space-y-6">
          {loading ? (
            <div className="card-autodocs space-y-3">
              <div className="skeleton h-6 w-40 rounded" />
              <div className="skeleton h-4 w-full rounded" />
              <div className="skeleton h-4 w-3/4 rounded" />
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "card-autodocs flex flex-col gap-4 border md:flex-row md:items-center md:justify-between",
                  isPro ? "border-primary/30 bg-primary/5" : "border-border/60",
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-input",
                      isPro ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {isPro ? <Sparkles className="h-6 w-6" /> : <CreditCard className="h-6 w-6" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-lg font-bold text-foreground">
                        {isPro ? "Plan Pro" : "Plan Gratuit"}
                      </h2>
                      {isPro && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-primary">
                          Pro
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isPro
                        ? renewal
                          ? `Renouvellement le ${renewal}`
                          : "Abonnement actif"
                        : `${QUOTA_GRATUIT} bons de commande par mois`}
                    </p>
                  </div>
                </div>

                {!isPro && (
                  <button
                    type="button"
                    className="btn-primary w-full cursor-pointer md:w-auto"
                    onClick={handleUpgrade}
                    disabled={submitting}
                  >
                    <Zap className="h-4 w-4" />
                    {submitting ? "Redirection..." : "Passer au Pro — 49 €/mois"}
                  </button>
                )}
              </div>

              {!isPro && (
                <div className="card-autodocs space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-foreground">Quota mensuel</span>
                    <span className="tabular-nums text-muted-foreground">
                      {bons} / {QUOTA_GRATUIT} bons utilisés
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        percent >= 100
                          ? "bg-destructive"
                          : percent >= 80
                            ? "bg-amber-500"
                            : "bg-primary",
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {percent >= 100
                      ? "Limite atteinte. Passez au plan Pro pour continuer à générer des bons."
                      : "Compteur remis à zéro à chaque début de mois pour le plan Gratuit."}
                  </p>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <PlanCard
                  name="Gratuit"
                  price="0 €"
                  cadence=""
                  current={!isPro}
                  features={[
                    `${QUOTA_GRATUIT} bons de commande par mois`,
                    "Import CSV / Excel du stock",
                    "Génération PDF",
                  ]}
                />
                <PlanCard
                  name="Pro"
                  price="49 €"
                  cadence="/ mois"
                  highlight
                  current={isPro}
                  features={[
                    "Bons de commande illimités",
                    "Support prioritaire",
                    "Toutes les fonctionnalités",
                  ]}
                  cta={
                    !isPro ? (
                      <button
                        type="button"
                        className="btn-primary w-full cursor-pointer"
                        onClick={handleUpgrade}
                        disabled={submitting}
                      >
                        {submitting ? "Redirection..." : "Passer au Pro"}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    ) : (
                      <div className="rounded-input border border-success/30 bg-success/10 px-3 py-2 text-center text-sm font-semibold text-success">
                        Plan actif
                      </div>
                    )
                  }
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

const PlanCard = ({
  name,
  price,
  cadence,
  features,
  highlight,
  current,
  cta,
}: {
  name: string;
  price: string;
  cadence: string;
  features: string[];
  highlight?: boolean;
  current?: boolean;
  cta?: React.ReactNode;
}) => (
  <div
    className={cn(
      "card-autodocs flex flex-col gap-4",
      highlight && "border-primary/40 shadow-indigo",
      current && !highlight && "border-success/30",
    )}
  >
    <div className="flex items-start justify-between">
      <div>
        <h3 className="font-display text-base font-bold text-foreground">{name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-3xl font-extrabold text-foreground">{price}</span>
          <span className="text-xs text-muted-foreground">{cadence}</span>
        </div>
      </div>
      {current && (
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
          Actuel
        </span>
      )}
    </div>
    <ul className="space-y-1.5 text-sm text-muted-foreground">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span>{f}</span>
        </li>
      ))}
    </ul>
    {cta && <div className="mt-auto pt-2">{cta}</div>}
  </div>
);

export default Abonnement;

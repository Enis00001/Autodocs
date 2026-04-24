import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CreditCard, Sparkles, Zap, Check, ArrowRight, Star } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import {
  loadAbonnement,
  startCheckout,
  QUOTA_GRATUIT,
  type AbonnementInfo,
  type CheckoutInterval,
} from "@/utils/abonnement";
import { cn } from "@/lib/utils";

const Abonnement = () => {
  const [info, setInfo] = useState<AbonnementInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<CheckoutInterval | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Garde-fou : on ne déclenche l'auto-checkout qu'une fois par vue.
  const autoCheckoutTriggeredRef = useRef(false);

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
      searchParams.delete("interval");
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

  const handleUpgrade = useCallback(
    async (interval: CheckoutInterval) => {
      setSubmitting(interval);
      try {
        await startCheckout(interval);
      } catch (err) {
        toast({
          title: "Paiement indisponible",
          description: err instanceof Error ? err.message : "Réessayez plus tard.",
          variant: "destructive",
        });
        setSubmitting(null);
      }
    },
    [],
  );

  // Auto-checkout : si on arrive sur /abonnement?plan=monthly|annual (flux
  // depuis la landing après login), on déclenche directement Stripe.
  useEffect(() => {
    if (loading || !info) return;
    if (autoCheckoutTriggeredRef.current) return;
    const rawPlan = searchParams.get("plan");
    const target: CheckoutInterval | null =
      rawPlan === "monthly" || rawPlan === "annual" ? rawPlan : null;
    if (!target) return;

    // Nettoie l'URL pour éviter un re-trigger si le user revient dessus.
    searchParams.delete("plan");
    setSearchParams(searchParams, { replace: true });

    // Si l'utilisateur est déjà Pro, on ne relance pas de checkout.
    if (info.plan === "pro") {
      toast({
        title: "Vous êtes déjà Pro",
        description: "Aucun nouveau paiement nécessaire.",
      });
      return;
    }

    autoCheckoutTriggeredRef.current = true;
    void handleUpgrade(target);
  }, [loading, info, searchParams, setSearchParams, handleUpgrade]);

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
                  <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
                    <button
                      type="button"
                      className="btn-secondary w-full cursor-pointer md:w-auto"
                      onClick={() => handleUpgrade("monthly")}
                      disabled={submitting !== null}
                    >
                      <Zap className="h-4 w-4" />
                      {submitting === "monthly" ? "Redirection…" : "Mensuel — 49 €/mois"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary w-full cursor-pointer md:w-auto"
                      onClick={() => handleUpgrade("annual")}
                      disabled={submitting !== null}
                    >
                      <Star className="h-4 w-4 fill-current" />
                      {submitting === "annual"
                        ? "Redirection…"
                        : "Annuel — 399 €/an · 2 mois offerts"}
                    </button>
                  </div>
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

              <div className="grid gap-4 md:grid-cols-3">
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
                  name="Pro mensuel"
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
                        className="btn-secondary w-full cursor-pointer"
                        onClick={() => handleUpgrade("monthly")}
                        disabled={submitting !== null}
                      >
                        {submitting === "monthly" ? "Redirection…" : "Choisir Mensuel"}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    ) : undefined
                  }
                />
                <PlanCard
                  name="Pro annuel"
                  price="399 €"
                  cadence="/ an"
                  badge="⭐ Meilleure offre"
                  featured
                  current={isPro}
                  features={[
                    "Tout le Pro mensuel",
                    "= 33 €/mois seulement",
                    "🎁 2 mois offerts",
                    "💰 Économisez 189 € / an",
                  ]}
                  cta={
                    !isPro ? (
                      <button
                        type="button"
                        className="btn-primary w-full cursor-pointer"
                        onClick={() => handleUpgrade("annual")}
                        disabled={submitting !== null}
                      >
                        {submitting === "annual" ? "Redirection…" : "Choisir Annuel"}
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
  featured,
  badge,
  current,
  cta,
}: {
  name: string;
  price: string;
  cadence: string;
  features: string[];
  /** Card mise en avant discrètement (bord indigo léger). */
  highlight?: boolean;
  /** Card "meilleure offre" : bord indigo brillant + badge + scale légère. */
  featured?: boolean;
  /** Badge affiché en haut de la card (ex: "⭐ Meilleure offre"). */
  badge?: string;
  current?: boolean;
  cta?: React.ReactNode;
}) => (
  <div
    className={cn(
      "card-autodocs relative flex flex-col gap-4",
      highlight && !featured && "border-primary/40 shadow-indigo",
      featured &&
        "border-2 border-primary/70 shadow-[0_0_0_1px_rgba(99,102,241,0.25),0_24px_60px_-20px_rgba(99,102,241,0.5)] plan-card-featured md:scale-[1.02]",
      current && !highlight && !featured && "border-success/30",
    )}
  >
    {featured && (
      <>
        {/* Bordure "brillante" animée (pointer-events-none pour ne pas bloquer les clics). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-card plan-card-shine"
        />
      </>
    )}
    {badge && (
      <span className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-[#4F46E5] to-[#6366F1] px-3 py-1 font-display text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/30">
        {badge}
      </span>
    )}
    <div className="flex items-start justify-between">
      <div>
        <h3 className="font-display text-base font-bold text-foreground">{name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="font-display text-3xl font-semibold text-foreground">{price}</span>
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

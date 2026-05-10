import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  Car,
  Package,
  Plus,
  FileEdit,
  Trash2,
  Inbox,
  ChartNoAxesCombined,
  BadgeEuro,
  ClipboardList,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { toast } from "@/hooks/use-toast";
import { BonDraftData, loadDrafts, deleteDraft } from "@/utils/drafts";
import { cn } from "@/lib/utils";
import { buildPdfFormDataFromDraft, generatePDF } from "@/utils/generatePDF";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import {
  DashboardPeriod,
  getMonthsForPeriod,
  loadDashboardStats,
  loadRecentSales,
  RecentSaleRow,
  sliceMonthlyByPeriod,
} from "@/utils/stats";

type DashboardStatsResult = Awaited<ReturnType<typeof loadDashboardStats>>;

type DashboardCacheEntry = {
  period: DashboardPeriod;
  timestamp: number;
  drafts: BonDraftData[];
  stats: DashboardStatsResult;
  recentSales: RecentSaleRow[];
};

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
let dashboardCache: DashboardCacheEntry | null = null;

function getCachedDashboard(period: DashboardPeriod): DashboardCacheEntry | null {
  if (!dashboardCache) return null;
  const isFresh = Date.now() - dashboardCache.timestamp < DASHBOARD_CACHE_TTL_MS;
  if (!isFresh || dashboardCache.period !== period) return null;
  return dashboardCache;
}

const isCurrentMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

function vehiculeLabel(d: BonDraftData): string {
  const order =
    d.stockColonnes?.length > 0 ? d.stockColonnes : Object.keys(d.stockDonnees ?? {});
  const vals = order.map((k) => (d.stockDonnees?.[k] ?? "").trim()).filter(Boolean);
  return vals.slice(0, 2).join(" · ") || "—";
}

const Dashboard = () => {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const initialCache = getCachedDashboard("month");
  const [drafts, setDrafts] = useState<BonDraftData[]>(initialCache?.drafts ?? []);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadingDraftId, setDownloadingDraftId] = useState<string | null>(null);
  const [stats, setStats] = useState<DashboardStatsResult | null>(initialCache?.stats ?? null);
  const [recentSales, setRecentSales] = useState<RecentSaleRow[]>(initialCache?.recentSales ?? []);
  const navigate = useNavigate();

  useEffect(() => {
    const cached = refreshKey === 0 ? getCachedDashboard(period) : null;
    if (cached) {
      setDrafts(cached.drafts);
      setStats(cached.stats);
      setRecentSales(cached.recentSales);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(!stats);
      setError(null);
      try {
        const [d, s, sales] = await Promise.all([
          loadDrafts(),
          loadDashboardStats(period),
          loadRecentSales(period, 5),
        ]);
        if (cancelled) return;
        setDrafts(d);
        setStats(s);
        setRecentSales(sales);
        dashboardCache = {
          period,
          timestamp: Date.now(),
          drafts: d,
          stats: s,
          recentSales: sales,
        };
      } catch (err) {
        if (cancelled) return;
        console.error("[dashboard] chargement stats:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Impossible de charger les statistiques.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, refreshKey, stats]);

  const handleRetry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onFocus = () => setRefreshKey((k) => k + 1);
    const intervalId = window.setInterval(() => setRefreshKey((k) => k + 1), 30000);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const bonsCeMois = drafts.filter((d) => isCurrentMonth(d.createdAt)).length;
  const brouillonsEnCours = drafts.length;
  const statsReady = stats ?? {
    monthly: [],
    stockAvailableTotal: 0,
    stockSoldTotal: 0,
    draftsTotal: 0,
    draftsSignedTotal: 0,
    draftsPendingTotal: 0,
    draftsInProgressTotal: 0,
    draftStatusById: {},
  };

  const monthsForPeriod = getMonthsForPeriod(period);
  const monthlyForPeriod = sliceMonthlyByPeriod(statsReady.monthly, period);
  const previousMonthlyForPeriod = statsReady.monthly.slice(
    Math.max(0, statsReady.monthly.length - monthsForPeriod * 2),
    Math.max(0, statsReady.monthly.length - monthsForPeriod),
  );

  const sum = (
    rows: typeof monthlyForPeriod,
    key: "revenue" | "sales" | "draftsSigned" | "draftsPending" | "draftsInProgress",
  ) => rows.reduce((acc, row) => acc + row[key], 0);

  const currentRevenue = sum(monthlyForPeriod, "revenue");
  const previousRevenue = sum(previousMonthlyForPeriod, "revenue");
  const currentSales = sum(monthlyForPeriod, "sales");
  const previousSales = sum(previousMonthlyForPeriod, "sales");
  const currentSigned = sum(monthlyForPeriod, "draftsSigned");
  const currentPending = sum(monthlyForPeriod, "draftsPending");
  const previousPending = sum(previousMonthlyForPeriod, "draftsPending");

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(value);

  const formatPercent = (current: number, previous: number) => {
    if (previous === 0) {
      if (current === 0) return { text: "0%", positive: true };
      return { text: "+100%", positive: true };
    }
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const rounded = Math.round(pct);
    const sign = rounded > 0 ? "+" : "";
    return { text: `${sign}${rounded}%`, positive: rounded >= 0 };
  };

  const revenueDelta = formatPercent(currentRevenue, previousRevenue);
  const salesDiff = currentSales - previousSales;
  const pendingDelta = formatPercent(currentPending, previousPending);

  const periodLabels: Record<DashboardPeriod, string> = {
    month: "Ce mois",
    "3m": "3 mois",
    "6m": "6 mois",
    year: "Cette annee",
  };

  const kpiCards = [
    {
      label: "CA de la periode",
      value: formatCurrency(currentRevenue),
      sub: `vs periode precedente ${revenueDelta.text}`,
      trendClass: revenueDelta.positive ? "text-success" : "text-destructive",
      icon: BadgeEuro,
      className: "border-primary/20 bg-primary/5 text-primary",
      iconBox: "bg-primary/20 text-primary",
      numberClass: "stat-number-indigo",
    },
    {
      label: "Ventes de la periode",
      value: `${currentSales}`,
      sub: `vs periode precedente ${salesDiff >= 0 ? "+" : ""}${salesDiff} vehicules`,
      trendClass: salesDiff >= 0 ? "text-success" : "text-destructive",
      icon: Car,
      className: "border-emerald-500/25 bg-emerald-500/5 text-emerald-400",
      iconBox: "bg-emerald-500/20 text-emerald-400",
      numberClass: "stat-number-success",
    },
    {
      label: "Stock disponible",
      value: `${statsReady.stockAvailableTotal}`,
      sub: `${currentSales} vendus sur ${periodLabels[period].toLowerCase()}`,
      trendClass: "text-muted-foreground",
      icon: Package,
      className: "border-orange-500/25 bg-orange-500/5 text-orange-400",
      iconBox: "bg-orange-500/20 text-orange-400",
      numberClass: "stat-number-warning",
    },
    {
      label: "Bons en attente",
      value: `${currentPending}`,
      sub: `${currentSigned} signes sur ${periodLabels[period].toLowerCase()} (${pendingDelta.text})`,
      trendClass: pendingDelta.positive ? "text-destructive" : "text-success",
      icon: ClipboardList,
      className: "border-violet-500/25 bg-violet-500/5 text-violet-400",
      iconBox: "bg-violet-500/20 text-violet-400",
      numberClass: "stat-number-violet",
    },
  ] as const;

  const latestDrafts = [...drafts]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  const chartMonthly = statsReady.monthly.map((row) => ({
    ...row,
    mois: row.label,
    ca: row.revenue,
    ventes: row.sales,
  }));

  return (
    <>
      <TopBar
        title="Tableau de bord"
        subtitle="Vue d'ensemble de votre activité"
        actions={
          <button
            type="button"
            className="btn-primary hidden cursor-pointer border-0 sm:inline-flex"
            onClick={() => navigate("/nouveau-bon")}
          >
            <Plus className="h-4 w-4" />
            Nouveau bon
          </button>
        }
      />
      <div className="page-shell">
        <div className="page-content space-y-6">
          <div className="sm:hidden">
            <button
              type="button"
              className="btn-primary w-full cursor-pointer border-0 py-3"
              onClick={() => navigate("/nouveau-bon")}
            >
              <Plus className="h-4 w-4" />
              Nouveau bon de commande
            </button>
          </div>

          <div className="card-autodocs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-foreground">
                  Statistiques avancees
                </h2>
                <p className="text-xs text-muted-foreground">
                  Analyse de vos ventes, de votre CA et des signatures.
                </p>
              </div>
              <div className="inline-flex rounded-input border border-border bg-background p-1">
                {(["month", "3m", "6m", "year"] as DashboardPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      period === p
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setPeriod(p)}
                  >
                    {periodLabels[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && !loading && (
            <div className="card-autodocs flex flex-col items-start gap-3 border border-destructive/30 bg-destructive/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-destructive/15 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Impossible de charger les statistiques
                  </p>
                  <p className="text-xs text-muted-foreground">{error}</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary cursor-pointer gap-1.5 text-xs"
                onClick={handleRetry}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Réessayer
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 md:gap-4">
            {kpiCards.map((s) => (
              <div
                key={s.label}
                className={cn(
                  "card-autodocs flex items-start gap-4 border transition-all duration-200",
                  s.className,
                )}
              >
                {loading ? (
                  <div className="skeleton h-12 w-12 shrink-0 rounded-input" />
                ) : (
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-input",
                      s.iconBox,
                    )}
                  >
                    <s.icon className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                  {loading ? (
                    <div className="skeleton mt-2 h-8 w-24 rounded" />
                  ) : (
                    <p className={cn("stat-number text-3xl", s.numberClass)}>
                      {s.value}
                    </p>
                  )}
                  {loading ? (
                    <div className="skeleton mt-2 h-3 w-28 rounded" />
                  ) : (
                    <p className={cn("text-[11px]", s.trendClass)}>{s.sub}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card-autodocs">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-foreground">
                Chiffre d'affaires
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {periodLabels[period]}
              </span>
            </div>
            {loading ? (
              <div className="skeleton h-72 w-full rounded-input" />
            ) : currentRevenue === 0 ? (
              <div className="flex h-72 flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ChartNoAxesCombined className="h-7 w-7" />
                </div>
                <p className="font-display text-base font-bold text-foreground">
                  Aucune donnée pour cette période
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Changez la période pour voir plus d'historique.
                </p>
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartMonthly}
                    margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(148, 163, 184, 0.15)"
                    />
                    <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(value: number) =>
                        new Intl.NumberFormat("fr-FR", {
                          notation: "compact",
                          maximumFractionDigits: 1,
                        }).format(Number(value))
                      }
                    />
                    <Tooltip
                      formatter={(value: number) => [
                        formatCurrency(Number(value)),
                        "CA",
                      ]}
                      labelFormatter={(label) => `Mois : ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="ca"
                      stroke="#3B82F6"
                      strokeWidth={2.5}
                      fill="url(#revenueGradient)"
                      dot={{ r: 4, fill: "#3B82F6", strokeWidth: 0 }}
                      activeDot={{ r: 6 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="card-autodocs w-full">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-foreground">
                  Ventes mensuelles
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {periodLabels[period]}
                </span>
              </div>
              {loading ? (
                <div className="skeleton h-72 w-full rounded-input" />
              ) : currentSales === 0 ? (
                <div className="flex h-72 flex-col items-center justify-center text-center">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <ChartNoAxesCombined className="h-7 w-7" />
                  </div>
                  <p className="font-display text-base font-bold text-foreground">
                    Aucune donnée pour cette période
                  </p>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Changez la période pour voir plus d'historique.
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={chartMonthly}
                      margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                      barSize={40}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(148, 163, 184, 0.15)"
                      />
                      <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number) => [
                          `${Number(value)} véhicule${Number(value) > 1 ? "s" : ""} vendu${Number(value) > 1 ? "s" : ""}`,
                          "",
                        ]}
                        labelFormatter={(label) => `Mois : ${label}`}
                        separator=""
                      />
                      <Bar dataKey="ventes" fill="#10B981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-autodocs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold text-foreground">
                Dernières ventes
              </h2>
              <button
                type="button"
                onClick={() => navigate("/stock-vehicules")}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
              >
                Voir tout
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton h-10 w-full rounded-input" />
                ))}
              </div>
            ) : recentSales.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Car className="h-7 w-7" />
                </div>
                <p className="font-display text-base font-bold text-foreground">
                  Aucune vente pour le moment
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Les véhicules marqués « vendu » apparaissent ici automatiquement.
                </p>
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 font-medium">Véhicule</th>
                      <th className="pb-3 font-medium">Client</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Date vente</th>
                      <th className="pb-3 text-right font-medium">Prix TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSales.map((sale) => (
                      <tr
                        key={sale.id}
                        className="row-hover border-b border-border/50 last:border-0"
                      >
                        <td
                          className="max-w-[180px] truncate py-3 font-medium text-foreground md:max-w-none"
                          title={sale.vehicule}
                        >
                          {sale.vehicule}
                        </td>
                        <td
                          className={cn(
                            "max-w-[140px] truncate py-3 md:max-w-none",
                            sale.hasFacture ? "text-muted-foreground" : "text-amber-400",
                          )}
                          title={sale.client}
                        >
                          {sale.client}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-muted-foreground md:table-cell">
                          {sale.createdAt
                            ? new Date(sale.createdAt).toLocaleDateString("fr-FR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                        <td className="py-3 text-right font-semibold tabular-nums">
                          {sale.prixTtc === null ? (
                            <span className="text-amber-400">Facture non générée</span>
                          ) : (
                            <span className="text-foreground">{formatCurrency(sale.prixTtc)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card-autodocs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold text-foreground">Derniers brouillons</h2>
              {!loading && drafts.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {drafts.length} enregistré{drafts.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-12 w-full rounded-input" />
                ))}
              </div>
            ) : latestDrafts.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Inbox className="h-8 w-8" />
                </div>
                <p className="font-display text-base font-bold text-foreground">Aucun brouillon</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Créez un bon de commande pour le retrouver ici.
                </p>
                <button
                  type="button"
                  className="btn-primary mt-4 cursor-pointer border-0"
                  onClick={() => navigate("/nouveau-bon")}
                >
                  <Plus className="h-4 w-4" />
                  Nouveau bon de commande
                </button>
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 font-medium">Client</th>
                      <th className="pb-3 font-medium">Véhicule</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Mise à jour</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Statut</th>
                      <th className="pb-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestDrafts.map((d) => {
                      const isDownloading = downloadingDraftId === d.id;
                      const signatureStatus = statsReady.draftStatusById[d.id] ?? "in_progress";
                      return (
                        <tr key={d.id} className="row-hover border-b border-border/50 last:border-0">
                          <td className="py-3 font-medium text-foreground">
                            {d.clientPrenom || d.clientNom
                              ? `${d.clientPrenom} ${d.clientNom}`.trim()
                              : "—"}
                          </td>
                          <td className="max-w-[160px] truncate py-3 text-muted-foreground md:max-w-[200px]" title={vehiculeLabel(d)}>
                            {vehiculeLabel(d)}
                          </td>
                          <td className="hidden whitespace-nowrap py-3 text-muted-foreground md:table-cell">
                            {new Date(d.updatedAt).toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="hidden py-3 md:table-cell">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                signatureStatus === "signed"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : signatureStatus === "pending"
                                    ? "bg-amber-500/15 text-amber-400"
                                    : "bg-slate-500/15 text-slate-300",
                              )}
                            >
                              {signatureStatus === "signed"
                                ? "Signé"
                                : signatureStatus === "pending"
                                  ? "En attente"
                                  : "Brouillon"}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5 md:gap-2">
                              <button
                                type="button"
                                className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                onClick={() => navigate(`/nouveau-bon/${d.id}`)}
                                aria-label="Ouvrir le brouillon"
                              >
                                <FileEdit className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Ouvrir</span>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                onClick={async () => {
                                  try {
                                    setDownloadingDraftId(d.id);
                                    await generatePDF(buildPdfFormDataFromDraft(d), { download: true });
                                  } catch (err) {
                                    console.error("[dashboard] téléchargement PDF:", err);
                                    window.alert(
                                      err instanceof Error
                                        ? err.message
                                        : "Impossible de télécharger le PDF.",
                                    );
                                  } finally {
                                    setDownloadingDraftId((curr) =>
                                      curr === d.id ? null : curr,
                                    );
                                  }
                                }}
                                disabled={isDownloading}
                                aria-label="Télécharger le PDF"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">
                                  {isDownloading ? "Téléchargement..." : "Télécharger"}
                                </span>
                              </button>
                              <button
                                type="button"
                                className="btn-danger cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                onClick={async () => {
                                  if (!window.confirm("Supprimer ce bon de commande ?")) return;
                                  try {
                                    await deleteDraft(d.id);
                                    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
                                    const t = toast({ title: "Bon supprimé ✓" });
                                    window.setTimeout(() => t.dismiss(), 3000);
                                  } catch (err) {
                                    const message =
                                      err instanceof Error
                                        ? err.message
                                        : "Suppression impossible.";
                                    toast({
                                      title: "Erreur de suppression",
                                      description: message,
                                      variant: "destructive",
                                    });
                                  }
                                }}
                                aria-label="Supprimer le brouillon"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="hidden md:inline">Supprimer</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!loading && (
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground md:grid-cols-4">
              <div className="card-autodocs py-3">
                <p className="font-medium text-foreground">{bonsCeMois}</p>
                <p>Bons crees ce mois</p>
              </div>
              <div className="card-autodocs py-3">
                <p className="font-medium text-foreground">{brouillonsEnCours}</p>
                <p>Brouillons en cours</p>
              </div>
              <div className="card-autodocs py-3">
                <p className="font-medium text-foreground">{statsReady.stockSoldTotal}</p>
                <p>Vehicules deja vendus</p>
              </div>
              <div className="card-autodocs py-3">
                <p className="font-medium text-foreground">{statsReady.draftsTotal}</p>
                <p>Total bons suivis</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Dashboard;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Download,
  Car,
  FolderOpen,
  Plus,
  FileEdit,
  Trash2,
  Inbox,
  ChartNoAxesCombined,
  BadgeEuro,
  ClipboardList,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { BonDraftData, loadDrafts, deleteDraft } from "@/utils/drafts";
import { isDraftFormComplete } from "@/utils/bonFormCompletion";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import { cn } from "@/lib/utils";
import { buildPdfFormDataFromDraft, generatePDF } from "@/utils/generatePDF";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DashboardPeriod,
  getMonthsForPeriod,
  loadDashboardStats,
  sliceMonthlyByPeriod,
} from "@/utils/stats";

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
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingDraftId, setDownloadingDraftId] = useState<string | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [stats, setStats] = useState<Awaited<ReturnType<typeof loadDashboardStats>> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [d, s] = await Promise.all([loadDrafts(), loadDashboardStats()]);
        if (cancelled) return;
        setDrafts(d);
        setStats(s);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
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
  };

  const monthsForPeriod = getMonthsForPeriod(period);
  const monthlyForPeriod = sliceMonthlyByPeriod(statsReady.monthly, period);
  const previousMonthlyForPeriod = statsReady.monthly.slice(
    Math.max(0, statsReady.monthly.length - monthsForPeriod * 2),
    Math.max(0, statsReady.monthly.length - monthsForPeriod),
  );

  const sum = (
    rows: typeof monthlyForPeriod,
    key: "revenue" | "sales" | "draftsSigned" | "draftsPending",
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
      icon: FolderOpen,
      className: "border-cyan-500/25 bg-cyan-500/5 text-cyan-300",
      iconBox: "bg-cyan-500/20 text-cyan-300",
      numberClass: "text-cyan-300",
    },
    {
      label: "Bons en attente",
      value: `${currentPending}`,
      sub: `${currentSigned} signes sur ${periodLabels[period].toLowerCase()} (${pendingDelta.text})`,
      trendClass: pendingDelta.positive ? "text-destructive" : "text-success",
      icon: ClipboardList,
      className: "border-amber-500/25 bg-amber-500/5 text-amber-400",
      iconBox: "bg-amber-500/20 text-amber-400",
      numberClass: "stat-number-warning",
    },
  ] as const;

  const pieData = [
    { name: "Signes", value: currentSigned, color: "#22c55e" },
    { name: "En attente", value: currentPending, color: "#f59e0b" },
  ];
  const noDataForPeriod = currentRevenue === 0 && currentSales === 0 && currentSigned === 0 && currentPending === 0;

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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="card-autodocs xl:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-foreground">
                  Evolution du chiffre d'affaires
                </h3>
                <span className="text-[11px] text-muted-foreground">12 derniers mois</span>
              </div>
              {loading ? (
                <div className="skeleton h-72 w-full rounded-input" />
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyForPeriod}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(Number(value))}
                        labelFormatter={(label) => `Mois: ${label}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="revenue"
                        stroke="#6366f1"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card-autodocs">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-foreground">
                  Bons signes vs attente
                </h3>
                <span className="text-[11px] text-muted-foreground">{periodLabels[period]}</span>
              </div>
              {loading ? (
                <div className="skeleton h-72 w-full rounded-input" />
              ) : (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                      >
                        {pieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="card-autodocs">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-foreground">
                Ventes de vehicules par mois
              </h3>
              <span className="text-[11px] text-muted-foreground">12 derniers mois</span>
            </div>
            {loading ? (
              <div className="skeleton h-72 w-full rounded-input" />
            ) : noDataForPeriod ? (
              <div className="flex h-72 flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <ChartNoAxesCombined className="h-7 w-7" />
                </div>
                <p className="font-display text-base font-bold text-foreground">
                  Aucune vente pour cette periode
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Changez la periode pour voir plus d'historique.
                </p>
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyForPeriod}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.15)" />
                    <XAxis dataKey="label" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="sales" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
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
            ) : drafts.length === 0 ? (
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
                    {drafts.map((d) => {
                      const complet = isDraftFormComplete(d as unknown as Record<string, unknown>);
                      const isDownloading = downloadingDraftId === d.id;
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
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                  complet
                                    ? "bg-success/15 text-success"
                                    : "bg-amber-500/15 text-amber-400",
                                )}
                              >
                                {complet ? "Complet" : "En cours"}
                              </span>
                              <SignatureStatusBadge draft={d} showResendButton />
                            </div>
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
                                  if (window.confirm("Supprimer ce brouillon ?")) {
                                    await deleteDraft(d.id);
                                    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
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

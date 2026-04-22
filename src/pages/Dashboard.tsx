import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Car,
  FolderOpen,
  Plus,
  FileEdit,
  Trash2,
  Inbox,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { BonDraftData, loadDrafts, deleteDraft } from "@/utils/drafts";
import { getCurrentUserId } from "@/lib/auth";
import { loadStockVehicules } from "@/utils/stockVehicules";
import { isDraftFormComplete } from "@/utils/bonFormCompletion";
import { cn } from "@/lib/utils";

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
  const [stockDispo, setStockDispo] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const uid = await getCurrentUserId();
        const [d, stock] = await Promise.all([
          loadDrafts(),
          uid ? loadStockVehicules(uid) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setDrafts(d);
        setStockDispo(stock.filter((v) => v.disponible).length);
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

  const statCards = [
    {
      label: "Bons ce mois",
      value: loading ? "—" : String(bonsCeMois),
      sub: "Brouillons créés",
      icon: FileText,
      className: "border-primary/20 bg-primary/5 text-primary",
      iconBox: "bg-primary/20 text-primary",
      numberClass: "stat-number-indigo",
    },
    {
      label: "Véhicules en stock",
      value: loading ? "—" : String(stockDispo),
      sub: "Disponibles",
      icon: Car,
      className: "border-success/25 bg-success/5 text-success",
      iconBox: "bg-success/20 text-success",
      numberClass: "stat-number-success",
    },
    {
      label: "Brouillons en cours",
      value: loading ? "—" : String(brouillonsEnCours),
      sub: "Tous",
      icon: FolderOpen,
      className: "border-amber-500/25 bg-amber-500/5 text-amber-400",
      iconBox: "bg-amber-500/20 text-amber-400",
      numberClass: "stat-number-warning",
    },
  ] as const;

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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {statCards.map((s) => (
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
                    <div className="skeleton mt-2 h-8 w-16 rounded" />
                  ) : (
                    <p className={cn("stat-number text-3xl", s.numberClass)}>
                      {s.value}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                </div>
              </div>
            ))}
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 font-medium">Client</th>
                      <th className="pb-3 font-medium">Véhicule</th>
                      <th className="pb-3 font-medium">Mise à jour</th>
                      <th className="pb-3 font-medium">Statut</th>
                      <th className="pb-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => {
                      const complet = isDraftFormComplete(d as unknown as Record<string, unknown>);
                      return (
                        <tr key={d.id} className="row-hover border-b border-border/50 last:border-0">
                          <td className="py-3 font-medium text-foreground">
                            {d.clientPrenom || d.clientNom
                              ? `${d.clientPrenom} ${d.clientNom}`.trim()
                              : "—"}
                          </td>
                          <td className="max-w-[200px] truncate py-3 text-muted-foreground" title={vehiculeLabel(d)}>
                            {vehiculeLabel(d)}
                          </td>
                          <td className="whitespace-nowrap py-3 text-muted-foreground">
                            {new Date(d.updatedAt).toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-3">
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
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="btn-secondary cursor-pointer gap-1.5 px-2.5 py-1.5 text-xs"
                                onClick={() => navigate(`/nouveau-bon/${d.id}`)}
                              >
                                <FileEdit className="h-3.5 w-3.5" />
                                Ouvrir
                              </button>
                              <button
                                type="button"
                                className="btn-danger cursor-pointer gap-1.5 px-2.5 py-1.5 text-xs"
                                onClick={async () => {
                                  if (window.confirm("Supprimer ce brouillon ?")) {
                                    await deleteDraft(d.id);
                                    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Supprimer
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
        </div>
      </div>
    </>
  );
};

export default Dashboard;

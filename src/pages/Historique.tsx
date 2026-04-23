import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, FileEdit, X, Trash2 } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts, deleteDraft } from "@/utils/drafts";
import { isDraftFormComplete } from "@/utils/bonFormCompletion";
import { cn } from "@/lib/utils";
import TopBar from "@/components/layout/TopBar";

const clientLabel = (d: BonDraftData) =>
  [d.clientPrenom, d.clientNom].filter(Boolean).join(" ").trim() || "—";

const vehiculeLabel = (d: BonDraftData) => {
  const order =
    d.stockColonnes?.length > 0 ? d.stockColonnes : Object.keys(d.stockDonnees ?? {});
  const vals = order.map((k) => (d.stockDonnees?.[k] ?? "").trim()).filter(Boolean);
  return vals.slice(0, 2).join(" · ") || "—";
};

const Historique = () => {
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    void loadDrafts().then(setDrafts);
  }, []);

  const filteredDrafts = useMemo(() => {
    const query = q.trim().toLowerCase();
    return drafts.filter((d) => {
      if (filterDate) {
        const created = new Date(d.createdAt);
        const y = created.getFullYear();
        const m = String(created.getMonth() + 1).padStart(2, "0");
        const day = String(created.getDate()).padStart(2, "0");
        if (`${y}-${m}-${day}` !== filterDate) return false;
      }
      if (!query) return true;
      const hay = `${clientLabel(d)} ${vehiculeLabel(d)}`.toLowerCase();
      return hay.includes(query);
    });
  }, [drafts, filterDate, q]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  return (
    <>
      <TopBar title="Historique" subtitle="Brouillons et parcours en cours" />
      <div className="page-shell">
        <div className="page-content space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Rechercher un client, un véhicule…"
                className="field-input w-full pl-9"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor="historique-date">
                Filtrer par date
              </label>
              <input
                id="historique-date"
                type="date"
                className="field-input w-full min-w-[150px] cursor-pointer"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
              {filterDate ? (
                <button
                  type="button"
                  className="btn-secondary cursor-pointer p-2"
                  onClick={() => setFilterDate("")}
                  title="Réinitialiser le filtre"
                  aria-label="Réinitialiser le filtre date"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="card-autodocs -mx-4 overflow-x-auto px-4 md:mx-0 md:px-5">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Client</th>
                  <th className="pb-3 font-medium">Véhicule</th>
                  <th className="hidden pb-3 font-medium md:table-cell">Date</th>
                  <th className="hidden pb-3 font-medium md:table-cell">Statut</th>
                  <th className="pb-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      {drafts.length === 0
                        ? "Aucun bon enregistré"
                        : "Aucun résultat pour ces filtres"}
                    </td>
                  </tr>
                ) : (
                  filteredDrafts.map((d) => {
                    const complet = isDraftFormComplete(d as unknown as Record<string, unknown>);
                    return (
                      <tr key={d.id} className="row-hover border-b border-border/50 last:border-0">
                        <td className="py-3 font-medium text-foreground">{clientLabel(d)}</td>
                        <td
                          className="max-w-[160px] truncate py-3 text-muted-foreground md:max-w-[220px]"
                          title={vehiculeLabel(d)}
                        >
                          {vehiculeLabel(d)}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-muted-foreground md:table-cell">
                          {formatDate(d.createdAt)}
                        </td>
                        <td className="hidden py-3 md:table-cell">
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
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

export default Historique;

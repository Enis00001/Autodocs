import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import { Search, FileEdit, X } from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts } from "@/utils/drafts";

const Historique = () => {
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [filterDate, setFilterDate] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    loadDrafts().then(setDrafts);
  }, []);

  const filteredDrafts = useMemo(() => {
    return drafts.filter((d) => {
      if (filterDate) {
        const created = new Date(d.createdAt);
        const y = created.getFullYear();
        const m = String(created.getMonth() + 1).padStart(2, "0");
        const day = String(created.getDate()).padStart(2, "0");
        const draftDateStr = `${y}-${m}-${day}`;
        if (draftDateStr !== filterDate) return false;
      }
      return true;
    });
  }, [drafts, filterDate]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const clientLabel = (d: BonDraftData) =>
    [d.clientPrenom, d.clientNom].filter(Boolean).join(" ").trim() || "—";

  return (
    <>
      <TopBar title="Historique" />
      <div className="page-shell">
        <div className="page-content space-y-5">
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input type="text" placeholder="Rechercher un client, véhicule..." className="field-input w-full pl-9" />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="historique-date">
              Filtrer par date
            </label>
            <input
              id="historique-date"
              type="date"
              className="field-input cursor-pointer w-full min-w-[140px]"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              onClick={(e) => (e.target as HTMLInputElement).showPicker()}
            />
            {filterDate ? (
              <button
                type="button"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                onClick={() => setFilterDate("")}
                title="Réinitialiser le filtre date"
                aria-label="Réinitialiser le filtre date"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>

        <div className="card-autodocs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-left">
                <th className="pb-3 font-medium">Client</th>
                <th className="pb-3 font-medium">Véhicule</th>
                <th className="pb-3 font-medium">Date</th>
                <th className="pb-3 font-medium">Statut</th>
                <th className="pb-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDrafts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                    {drafts.length === 0
                      ? "Aucun bon de commande pour le moment"
                      : "Aucun bon ne correspond aux filtres"}
                  </td>
                </tr>
              ) : (
                filteredDrafts.map((d) => (
                  <tr key={d.id} className="border-b border-border/50 last:border-0 row-hover">
                    <td className="py-3 font-medium">{clientLabel(d)}</td>
                    <td className="py-3 text-muted-foreground">{d.vehiculeModele || "—"}</td>
                    <td className="py-3 text-muted-foreground">{formatDate(d.createdAt)}</td>
                    <td className="py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-warning/15 text-warning">
                        Brouillon
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                        onClick={() => navigate(`/nouveau-bon/${d.id}`)}
                      >
                        <FileEdit className="w-3 h-3" />
                        Modifier
                      </button>
                    </td>
                  </tr>
                ))
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

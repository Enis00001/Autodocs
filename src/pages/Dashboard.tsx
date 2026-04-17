import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import { FileText, FolderOpen, Clock, FileEdit, Trash2 } from "lucide-react";
import { BonDraftData, loadDrafts, deleteDraft } from "@/utils/drafts";

const isCurrentMonth = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

function formatDerniereActivite(drafts: BonDraftData[]): string {
  if (!drafts.length) return "—";
  const latest = drafts.reduce((a, b) =>
    new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a
  );
  const d = new Date(latest.updatedAt);
  const dateStr = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} à ${timeStr}`;
}

const Dashboard = () => {
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadDrafts().then(setDrafts);
  }, []);

  const draftsCeMois = drafts.filter((d) => isCurrentMonth(d.createdAt));
  const bonsCeMois = draftsCeMois.length;
  const bonsTotal = drafts.length;
  const derniereActivite = formatDerniereActivite(drafts);

  const stats = [
    { label: "Bons ce mois", value: String(bonsCeMois), icon: FileText },
    { label: "Bons total", value: String(bonsTotal), icon: FolderOpen },
    { label: "Dernière activité", value: derniereActivite, icon: Clock },
  ];

  return (
    <>
      <TopBar
        title="Dashboard"
        actions={
          <button
            className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0"
            style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
            onClick={() => navigate("/nouveau-bon")}
          >
            + Nouveau bon de commande
          </button>
        }
      />
      <div className="page-shell">
        <div className="page-content space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {stats.map((s) => (
            <div key={s.label} className="card-autodocs flex items-center gap-4 interactive-lift">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-display font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Brouillons sauvegardés */}
        <div className="card-autodocs">
          <div className="flex items-center justify-between mb-4">
            <div className="card-title-autodocs">Brouillons sauvegardés</div>
            {drafts.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                {drafts.length} brouillon{drafts.length > 1 ? "s" : ""} en cours
              </div>
            )}
          </div>
          {drafts.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              Aucun brouillon pour le moment. Cliquez sur "Nouveau bon de commande" pour commencer.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-left">
                  <th className="pb-3 font-medium">Client</th>
                  <th className="pb-3 font-medium">Véhicule</th>
                  <th className="pb-3 font-medium">Vendeur</th>
                  <th className="pb-3 font-medium">Mis à jour</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id} className="border-b border-border/50 last:border-0 row-hover">
                    <td className="py-3 font-medium">
                      {d.clientPrenom || d.clientNom
                        ? `${d.clientPrenom} ${d.clientNom}`.trim()
                        : "Client sans nom"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {d.vehiculeModele || "—"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {d.vendeurNom || "—"}
                    </td>
                    <td className="py-3 text-muted-foreground">
                      {new Date(d.updatedAt).toLocaleString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors bg-transparent cursor-pointer"
                          onClick={() => navigate(`/nouveau-bon/${d.id}`)}
                        >
                          <FileEdit className="w-3 h-3" />
                          Modifier
                        </button>
                        <button
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-destructive/60 text-destructive hover:border-destructive hover:text-destructive transition-colors bg-transparent cursor-pointer"
                          onClick={async () => {
                            if (window.confirm("Êtes-vous sûr de vouloir supprimer ce bon de commande ?")) {
                              await deleteDraft(d.id);
                              setDrafts((prev) => prev.filter((x) => x.id !== d.id));
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>
    </>
  );
};

export default Dashboard;

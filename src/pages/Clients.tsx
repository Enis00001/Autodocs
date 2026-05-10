import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, UserPlus, Users as UsersIcon } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ClientFormModal from "@/components/ClientFormModal";
import {
  ClientData,
  ClientStats,
  createClient,
  getClients,
  getClientStats,
} from "@/utils/clients";

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const Clients = () => {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientData[]>([]);
  const [stats, setStats] = useState<Map<string, ClientStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, statsMap] = await Promise.all([getClients(), getClientStats()]);
      setClients(list);
      setStats(statsMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener("autodocs_clients_updated", onUpdate);
    window.addEventListener("autodocs_drafts_updated", onUpdate);
    return () => {
      window.removeEventListener("autodocs_clients_updated", onUpdate);
      window.removeEventListener("autodocs_drafts_updated", onUpdate);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const hay = `${c.nom} ${c.prenom} ${c.email} ${c.telephone}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clients, query]);

  const handleCreate = async (input: Parameters<typeof createClient>[0]) => {
    const created = await createClient(input);
    setModalOpen(false);
    await refresh();
    navigate(`/clients/${created.id}`);
  };

  return (
    <>
      <TopBar
        title="Clients"
        subtitle="Fichier client de votre concession"
        actions={
          <button
            type="button"
            className="btn-primary hidden cursor-pointer border-0 sm:inline-flex"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Nouveau client
          </button>
        }
      />
      <div className="page-shell">
        <div className="page-content space-y-5">
          <div className="sm:hidden">
            <button
              type="button"
              className="btn-primary w-full cursor-pointer border-0 py-3"
              onClick={() => setModalOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Nouveau client
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Rechercher par nom, prénom ou email…"
                className="field-input w-full pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {!loading && clients.length > 0 ? (
              <span className="text-[11px] text-muted-foreground">
                {filtered.length} client{filtered.length > 1 ? "s" : ""}
                {filtered.length !== clients.length ? ` / ${clients.length}` : ""}
              </span>
            ) : null}
          </div>

          <div className="card-autodocs -mx-4 overflow-x-auto px-4 md:mx-0 md:px-5">
            {loading ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton h-12 w-full rounded-input" />
                ))}
              </div>
            ) : clients.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <UsersIcon className="h-8 w-8" />
                </div>
                <p className="font-display text-base font-bold text-foreground">
                  Aucun client enregistré
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Créez une fiche client pour centraliser ses coordonnées et
                  retrouver tous ses bons de commande au même endroit.
                </p>
                <button
                  type="button"
                  className="btn-primary mt-4 cursor-pointer border-0"
                  onClick={() => setModalOpen(true)}
                >
                  <UserPlus className="h-4 w-4" />
                  Créer mon premier client
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Aucun résultat pour « {query} »
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">Nom</th>
                    <th className="pb-3 font-medium">Prénom</th>
                    <th className="hidden pb-3 font-medium md:table-cell">Email</th>
                    <th className="hidden pb-3 font-medium md:table-cell">Téléphone</th>
                    <th className="pb-3 text-right font-medium">Bons</th>
                    <th className="hidden pb-3 text-right font-medium md:table-cell">
                      Dernier bon
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const stat = stats.get(c.id);
                    const bonsCount = stat?.bonsCount ?? 0;
                    return (
                      <tr
                        key={c.id}
                        className="row-hover cursor-pointer border-b border-border/50 last:border-0"
                        onClick={() => navigate(`/clients/${c.id}`)}
                      >
                        <td className="py-3 font-medium text-foreground">
                          {c.nom || "—"}
                        </td>
                        <td className="py-3 text-muted-foreground">{c.prenom || "—"}</td>
                        <td className="hidden max-w-[220px] truncate py-3 text-muted-foreground md:table-cell">
                          {c.email || "—"}
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-muted-foreground md:table-cell">
                          {c.telephone || "—"}
                        </td>
                        <td className="py-3 text-right">
                          <span
                            className={
                              bonsCount > 0
                                ? "inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary"
                                : "text-muted-foreground"
                            }
                          >
                            {bonsCount}
                          </span>
                        </td>
                        <td className="hidden whitespace-nowrap py-3 text-right text-muted-foreground md:table-cell">
                          {formatDate(stat?.lastBonAt ?? null)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <ClientFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </>
  );
};

export default Clients;

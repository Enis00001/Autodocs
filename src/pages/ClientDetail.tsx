import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Mail,
  Phone,
  Cake,
  FileText,
  Inbox,
  CheckCircle2,
  Clock,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ClientFormModal from "@/components/ClientFormModal";
import {
  ClientBonResume,
  ClientData,
  ClientUpsertData,
  deleteClient,
  getBonsForClient,
  getClientById,
  updateClient,
} from "@/utils/clients";
import { cn } from "@/lib/utils";

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

const formatNaissance = (raw: string) => {
  const trimmed = raw?.trim();
  if (!trimmed) return "—";
  // ISO yyyy-mm-dd → joli
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return trimmed;
};

type BonStatus = {
  label: string;
  className: string;
  icon: typeof CheckCircle2;
};

function bonStatus(b: ClientBonResume): BonStatus {
  if (b.signed && b.clientSigned) {
    return {
      label: "Signé",
      className: "bg-success/15 text-success",
      icon: CheckCircle2,
    };
  }
  if (b.signatureSent && !b.clientSigned) {
    return {
      label: "Signature en attente",
      className: "bg-amber-500/15 text-amber-400",
      icon: Clock,
    };
  }
  if (b.signed) {
    return {
      label: "Signé vendeur",
      className: "bg-primary/15 text-primary",
      icon: CheckCircle2,
    };
  }
  return {
    label: "Brouillon",
    className: "bg-muted/40 text-muted-foreground",
    icon: FileText,
  };
}

const ClientDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [client, setClient] = useState<ClientData | null>(null);
  const [bons, setBons] = useState<ClientBonResume[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const [c, list] = await Promise.all([getClientById(id), getBonsForClient(id)]);
        if (cancelled) return;
        if (!c) {
          setNotFound(true);
        } else {
          setClient(c);
          setBons(list);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSave = async (input: ClientUpsertData) => {
    if (!id) return;
    const updated = await updateClient(id, input);
    setClient(updated);
    setEditOpen(false);
  };

  const handleDelete = async () => {
    if (!id || !client) return;
    const confirmation = window.confirm(
      `Supprimer la fiche de ${client.prenom} ${client.nom} ?\n\nLes bons de commande liés seront conservés mais ne seront plus rattachés à un client.`,
    );
    if (!confirmation) return;
    try {
      setDeleting(true);
      await deleteClient(id);
      navigate("/clients", { replace: true });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <>
        <TopBar title="Fiche client" />
        <div className="page-shell">
          <div className="page-content space-y-4">
            <div className="skeleton h-32 w-full rounded-card" />
            <div className="skeleton h-48 w-full rounded-card" />
          </div>
        </div>
      </>
    );
  }

  if (notFound || !client) {
    return (
      <>
        <TopBar title="Fiche client" />
        <div className="page-shell">
          <div className="page-content">
            <div className="card-autodocs flex flex-col items-center py-10 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <Inbox className="h-8 w-8" />
              </div>
              <p className="font-display text-base font-bold text-foreground">
                Client introuvable
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Cette fiche client n'existe plus ou n'appartient pas à votre concession.
              </p>
              <button
                type="button"
                className="btn-secondary mt-4 cursor-pointer"
                onClick={() => navigate("/clients")}
              >
                <ArrowLeft className="h-4 w-4" />
                Retour aux clients
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const fullName = `${client.prenom} ${client.nom}`.trim();

  return (
    <>
      <TopBar
        title={fullName || "Fiche client"}
        subtitle="Coordonnées et historique des bons de commande"
        actions={
          <button
            type="button"
            className="btn-secondary cursor-pointer"
            onClick={() => navigate("/clients")}
            aria-label="Retour à la liste des clients"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Retour</span>
          </button>
        }
      />
      <div className="page-shell">
        <div className="page-content space-y-5">
          <div className="card-autodocs">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary font-display text-lg font-bold">
                  {(client.prenom?.[0] ?? "").toUpperCase()}
                  {(client.nom?.[0] ?? "").toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-bold text-foreground">
                    {fullName || "—"}
                  </h2>
                  <div className="mt-2 grid gap-1.5 text-[13px] text-muted-foreground md:grid-cols-2">
                    <span className="inline-flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      {client.email || "—"}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      {client.telephone || "—"}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Cake className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      {formatNaissance(client.dateNaissance)}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      Fiche créée le {formatDate(client.createdAt)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-start">
                <button
                  type="button"
                  className="btn-secondary cursor-pointer"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Modifier
                </button>
                <button
                  type="button"
                  className="btn-danger cursor-pointer"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </div>
          </div>

          <div className="card-autodocs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-foreground">
                Historique des bons de commande
              </h3>
              {bons.length > 0 ? (
                <span className="text-[11px] text-muted-foreground">
                  {bons.length} bon{bons.length > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>

            {bons.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Inbox className="h-8 w-8" />
                </div>
                <p className="font-display text-base font-bold text-foreground">
                  Aucun bon lié
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Les bons de commande créés pour ce client apparaîtront ici dès qu'ils
                  seront rattachés à sa fiche.
                </p>
              </div>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="pb-3 font-medium">Date</th>
                      <th className="pb-3 font-medium">Véhicule</th>
                      <th className="hidden pb-3 font-medium md:table-cell">Statut</th>
                      <th className="pb-3 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bons.map((b) => {
                      const status = bonStatus(b);
                      const StatusIcon = status.icon;
                      return (
                        <tr
                          key={b.id}
                          className="row-hover cursor-pointer border-b border-border/50 last:border-0"
                          onClick={() => navigate(`/nouveau-bon/${b.id}`)}
                        >
                          <td className="whitespace-nowrap py-3 text-muted-foreground">
                            {formatDate(b.createdAt)}
                          </td>
                          <td className="max-w-[200px] truncate py-3 font-medium text-foreground">
                            {b.vehiculeLabel}
                          </td>
                          <td className="hidden py-3 md:table-cell">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                status.className,
                              )}
                            >
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <span className="text-[12px] font-medium text-primary">
                              Ouvrir →
                            </span>
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

      <ClientFormModal
        open={editOpen}
        initial={client}
        onClose={() => setEditOpen(false)}
        onSubmit={handleSave}
      />
    </>
  );
};

export default ClientDetail;

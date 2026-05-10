import { useEffect, useMemo, useState } from "react";
import { Download, Filter, Loader2, CheckCircle2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import { cn } from "@/lib/utils";
import {
  getFactures,
  updateFactureStatut,
  type FactureRecord,
  type FactureStatut,
} from "@/utils/factures";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import { toast } from "@/hooks/use-toast";

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function clientLabel(f: FactureRecord): string {
  const n = [f.client_prenom, f.client_nom].filter(Boolean).join(" ").trim();
  return n || "—";
}

function vehiculeLabel(f: FactureRecord): string {
  const parts = [f.vehicule_marque, f.vehicule_modele].filter(Boolean);
  return parts.join(" ") || "—";
}

function statutBadge(statut: FactureStatut): { label: string; className: string } {
  switch (statut) {
    case "payee":
      return { label: "Payée", className: "bg-success/15 text-success" };
    case "annulee":
      return { label: "Annulée", className: "bg-muted/50 text-muted-foreground" };
    default:
      return { label: "Émise", className: "bg-primary/15 text-primary" };
  }
}

const Factures = () => {
  const [rows, setRows] = useState<FactureRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatut, setFilterStatut] = useState<FactureStatut | "all">("all");
  const [filterDate, setFilterDate] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await getFactures();
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onUp = () => void refresh();
    window.addEventListener("autodocs_factures_updated", onUp);
    return () => window.removeEventListener("autodocs_factures_updated", onUp);
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((f) => {
      if (filterStatut !== "all" && f.statut !== filterStatut) return false;
      if (filterDate) {
        const d = f.date_facture?.slice(0, 10);
        if (d !== filterDate) return false;
      }
      return true;
    });
  }, [rows, filterStatut, filterDate]);

  const handleDownload = async (f: FactureRecord) => {
    if (!f.pdf_base64) {
      toast({
        title: "PDF indisponible",
        description: "Aucun fichier enregistré pour cette facture.",
        variant: "destructive",
      });
      return;
    }
    setDownloadingId(f.id);
    try {
      downloadBase64Pdf(f.pdf_base64, `facture-${f.numero_facture}.pdf`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleMarkPayee = async (f: FactureRecord) => {
    if (f.statut !== "emise") return;
    const ok = window.confirm(
      `Marquer la facture ${f.numero_facture} comme payée ?`,
    );
    if (!ok) return;
    setUpdatingId(f.id);
    try {
      await updateFactureStatut(f.id, "payee");
      toast({ title: "Statut mis à jour", description: "Facture marquée comme payée." });
      await refresh();
    } catch (err) {
      toast({
        title: "Échec",
        description: err instanceof Error ? err.message : "Mise à jour impossible.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <>
      <TopBar title="Factures" subtitle="Facturation véhicule — PDF conformes" />
      <div className="page-shell">
        <div className="page-content space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-4 w-4" />
              <span className="text-[13px] font-medium">Filtres</span>
            </div>
            <select
              className="field-input min-w-[140px] cursor-pointer"
              value={filterStatut}
              onChange={(e) =>
                setFilterStatut(e.target.value as FactureStatut | "all")
              }
              aria-label="Filtrer par statut"
            >
              <option value="all">Tous les statuts</option>
              <option value="emise">Émise</option>
              <option value="payee">Payée</option>
              <option value="annulee">Annulée</option>
            </select>
            <label className="sr-only" htmlFor="factures-filter-date">
              Date de facture
            </label>
            <input
              id="factures-filter-date"
              type="date"
              className="field-input min-w-[150px] cursor-pointer"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
            />
            {filterDate ? (
              <button
                type="button"
                className="btn-secondary cursor-pointer px-3 py-2 text-xs"
                onClick={() => setFilterDate("")}
              >
                Réinitialiser la date
              </button>
            ) : null}
          </div>

          <div className="card-autodocs -mx-4 overflow-x-auto px-4 md:mx-0 md:px-5">
            {loading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-3 font-medium">N° facture</th>
                    <th className="pb-3 font-medium">Date</th>
                    <th className="pb-3 font-medium">Client</th>
                    <th className="hidden pb-3 font-medium md:table-cell">Véhicule</th>
                    <th className="hidden pb-3 font-medium lg:table-cell text-right">
                      Montant TTC
                    </th>
                    <th className="pb-3 font-medium">Statut</th>
                    <th className="pb-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-12 text-center text-sm text-muted-foreground"
                      >
                        {rows.length === 0
                          ? "Aucune facture pour le moment."
                          : "Aucun résultat pour ces filtres."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((f) => {
                      const st = statutBadge(f.statut);
                      const busy = updatingId === f.id || downloadingId === f.id;
                      return (
                        <tr
                          key={f.id}
                          className="row-hover border-b border-border/50 last:border-0"
                        >
                          <td className="py-3 font-semibold text-foreground">
                            {f.numero_facture}
                          </td>
                          <td className="whitespace-nowrap py-3 text-muted-foreground">
                            {formatDate(f.date_facture)}
                          </td>
                          <td className="py-3 font-medium text-foreground">
                            {clientLabel(f)}
                          </td>
                          <td className="hidden max-w-[180px] truncate py-3 text-muted-foreground md:table-cell">
                            {vehiculeLabel(f)}
                          </td>
                          <td className="hidden whitespace-nowrap py-3 text-right font-medium text-foreground lg:table-cell">
                            {formatMoney(f.prix_ttc)} €
                          </td>
                          <td className="py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                st.className,
                              )}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                className="btn-secondary cursor-pointer gap-1 px-2 py-1.5 text-xs"
                                disabled={busy || !f.pdf_base64}
                                onClick={() => void handleDownload(f)}
                              >
                                {downloadingId === f.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                                PDF
                              </button>
                              {f.statut === "emise" ? (
                                <button
                                  type="button"
                                  className="btn-secondary cursor-pointer gap-1 px-2 py-1.5 text-xs border-success/40 text-success hover:bg-success/10"
                                  disabled={busy}
                                  onClick={() => void handleMarkPayee(f)}
                                >
                                  {updatingId === f.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  )}
                                  Payée
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Factures;

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  FileEdit,
  X,
  Trash2,
  Download,
  UserPlus,
  UserCircle,
  Receipt,
  FileCheck,
  Mail,
  MailCheck,
  Loader2,
} from "lucide-react";
import type { BonDraftData } from "@/utils/drafts";
import { loadDrafts, deleteDraft } from "@/utils/drafts";
import { isDraftFormComplete } from "@/utils/bonFormCompletion";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import ClientFormModal from "@/components/ClientFormModal";
import {
  attachDraftToClient,
  ClientData,
  ClientUpsertData,
  clientUpsertFromDraft,
  createClient,
  findClientByNomPrenom,
  getClients,
} from "@/utils/clients";
import { cn } from "@/lib/utils";
import TopBar from "@/components/layout/TopBar";
import { buildPdfFormDataFromDraft, generatePDF, downloadBase64Pdf } from "@/utils/generatePDF";
import FactureGenerateModal from "@/components/FactureGenerateModal";
import { getFactures, getFactureById, sendFactureEmail } from "@/utils/factures";
import { toast } from "@/hooks/use-toast";

const clientLabel = (d: BonDraftData) =>
  [d.clientPrenom, d.clientNom].filter(Boolean).join(" ").trim() || "—";

const vehiculeLabel = (d: BonDraftData) => {
  const order =
    d.stockColonnes?.length > 0 ? d.stockColonnes : Object.keys(d.stockDonnees ?? {});
  const vals = order.map((k) => (d.stockDonnees?.[k] ?? "").trim()).filter(Boolean);
  return vals.slice(0, 2).join(" · ") || "—";
};

type CrmState =
  | { kind: "linked"; clientId: string }
  | { kind: "match"; client: ClientData }
  | { kind: "missing" }
  | { kind: "empty" };

export type DraftsListPageProps = {
  topBarTitle: string;
  topBarSubtitle: string;
  /** Identifiant unique pour l'input date (accessibilité). */
  dateFilterInputId: string;
};

const DraftsListPage = ({
  topBarTitle,
  topBarSubtitle,
  dateFilterInputId,
}: DraftsListPageProps) => {
  const [drafts, setDrafts] = useState<BonDraftData[]>([]);
  const [clients, setClients] = useState<ClientData[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [q, setQ] = useState("");
  const [downloadingDraftId, setDownloadingDraftId] = useState<string | null>(null);
  const [creatingForDraft, setCreatingForDraft] = useState<BonDraftData | null>(null);
  const [linkingDraftId, setLinkingDraftId] = useState<string | null>(null);
  type FactureRowMeta = {
    id: string;
    numero_facture: string;
    client_email: string | null;
    email_envoye_at: string | null;
  };
  const [facturesByBrouillon, setFacturesByBrouillon] = useState<
    Map<string, FactureRowMeta>
  >(() => new Map());
  const [factureModalDraft, setFactureModalDraft] = useState<BonDraftData | null>(
    null,
  );
  const [factureLoadingId, setFactureLoadingId] = useState<string | null>(null);
  const [emailSendingId, setEmailSendingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = async () => {
    const [d, c, facts] = await Promise.all([
      loadDrafts(),
      getClients(),
      getFactures(),
    ]);
    setDrafts(d);
    setClients(c);
    const m = new Map<string, FactureRowMeta>();
    for (const f of facts) {
      if (f.brouillon_id)
        m.set(f.brouillon_id, {
          id: f.id,
          numero_facture: f.numero_facture,
          client_email: f.client_email,
          email_envoye_at: f.email_envoye_at,
        });
    }
    setFacturesByBrouillon(m);
  };

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener("autodocs_drafts_updated", onUpdate);
    window.addEventListener("autodocs_clients_updated", onUpdate);
    window.addEventListener("autodocs_factures_updated", onUpdate);
    return () => {
      window.removeEventListener("autodocs_drafts_updated", onUpdate);
      window.removeEventListener("autodocs_clients_updated", onUpdate);
      window.removeEventListener("autodocs_factures_updated", onUpdate);
    };
  }, []);

  const handleVoirFacture = async (brouillonId: string) => {
    const meta = facturesByBrouillon.get(brouillonId);
    if (!meta) return;
    setFactureLoadingId(brouillonId);
    try {
      const full = await getFactureById(meta.id);
      if (full?.pdf_base64) {
        downloadBase64Pdf(full.pdf_base64, `facture-${full.numero_facture}.pdf`);
      } else {
        window.alert("PDF introuvable pour cette facture.");
      }
    } finally {
      setFactureLoadingId(null);
    }
  };

  const handleEnvoyerFacture = async (d: BonDraftData) => {
    const meta = facturesByBrouillon.get(d.id);
    if (!meta) return;
    const email = (meta.client_email ?? d.clientEmail ?? "").trim();
    if (!email) {
      toast({
        title: "Pas d'email client",
        description: "Renseignez l'email du client avant d'envoyer la facture.",
        variant: "destructive",
      });
      return;
    }
    if (!window.confirm(`Envoyer la facture à ${email} ?`)) return;
    setEmailSendingId(d.id);
    try {
      const res = await sendFactureEmail({
        facture_id: meta.id,
        client_email: email,
        client_nom: d.clientNom?.trim() || "",
        client_prenom: d.clientPrenom?.trim() || "",
        numero_facture: meta.numero_facture,
      });
      if (res.ok) {
        toast({ title: "Facture envoyée ✓", description: `Email envoyé à ${email}.` });
        await refresh();
      } else {
        toast({
          title: "Envoi échoué",
          description: res.error ?? "Impossible d'envoyer l'email.",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Envoi échoué",
        description:
          err instanceof Error ? err.message : "Impossible d'envoyer l'email.",
        variant: "destructive",
      });
    } finally {
      setEmailSendingId(null);
    }
  };

  const clientsByName = useMemo(() => {
    const map = new Map<string, ClientData>();
    for (const c of clients) {
      const key = `${c.nom.trim().toLowerCase()}|${c.prenom.trim().toLowerCase()}`;
      if (!map.has(key)) map.set(key, c);
    }
    return map;
  }, [clients]);

  const crmStateOf = (d: BonDraftData): CrmState => {
    if (d.clientId) return { kind: "linked", clientId: d.clientId };
    const nom = d.clientNom?.trim();
    const prenom = d.clientPrenom?.trim();
    if (!nom || !prenom) return { kind: "empty" };
    const match = clientsByName.get(`${nom.toLowerCase()}|${prenom.toLowerCase()}`);
    if (match) return { kind: "match", client: match };
    return { kind: "missing" };
  };

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

  const handleAttach = async (draftId: string, clientId: string) => {
    try {
      setLinkingDraftId(draftId);
      await attachDraftToClient(draftId, clientId);
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Liaison impossible.");
    } finally {
      setLinkingDraftId(null);
    }
  };

  const handleCreateFromDraft = async (input: ClientUpsertData) => {
    if (!creatingForDraft) return;
    const existing = await findClientByNomPrenom(input.nom, input.prenom);
    const target = existing ?? (await createClient(input));
    await attachDraftToClient(creatingForDraft.id, target.id);
    setCreatingForDraft(null);
    await refresh();
  };

  return (
    <>
      <TopBar title={topBarTitle} subtitle={topBarSubtitle} />
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
              <label className="sr-only" htmlFor={dateFilterInputId}>
                Filtrer par date
              </label>
              <input
                id={dateFilterInputId}
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
                  <th className="hidden pb-3 font-medium lg:table-cell">Fiche</th>
                  <th className="pb-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrafts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {drafts.length === 0
                        ? "Aucun bon enregistré"
                        : "Aucun résultat pour ces filtres"}
                    </td>
                  </tr>
                ) : (
                  filteredDrafts.map((d) => {
                    const complet = isDraftFormComplete(d as unknown as Record<string, unknown>);
                    const isDownloading = downloadingDraftId === d.id;
                    const isLinking = linkingDraftId === d.id;
                    const crm = crmStateOf(d);
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
                        <td className="hidden py-3 lg:table-cell">
                          {crm.kind === "linked" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                              onClick={() => navigate(`/clients/${crm.clientId}`)}
                              aria-label="Voir la fiche client"
                            >
                              <UserCircle className="h-3.5 w-3.5" />
                              Voir la fiche
                            </button>
                          ) : crm.kind === "match" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline disabled:opacity-50"
                              onClick={() => void handleAttach(d.id, crm.client.id)}
                              disabled={isLinking}
                              aria-label="Lier le brouillon à la fiche client existante"
                            >
                              <UserCircle className="h-3.5 w-3.5" />
                              {isLinking ? "Liaison…" : "Lier la fiche"}
                            </button>
                          ) : crm.kind === "missing" ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-primary"
                              onClick={() => setCreatingForDraft(d)}
                              aria-label="Créer une fiche client à partir de ce brouillon"
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                              Créer la fiche
                            </button>
                          ) : (
                            <span className="text-[12px] text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5 md:gap-2">
                            {(() => {
                              const factureMeta = facturesByBrouillon.get(d.id);
                              if (!factureMeta) {
                                return (
                                  <button
                                    type="button"
                                    className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                    onClick={() => setFactureModalDraft(d)}
                                    aria-label="Générer la facture"
                                    title="Générer la facture"
                                  >
                                    <Receipt className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Générer la facture</span>
                                  </button>
                                );
                              }
                              const email = (factureMeta.client_email ?? d.clientEmail ?? "").trim();
                              const sentAt = factureMeta.email_envoye_at;
                              const sending = emailSendingId === d.id;
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5 border-primary/30 text-primary"
                                    onClick={() => void handleVoirFacture(d.id)}
                                    disabled={factureLoadingId === d.id}
                                    aria-label="Voir la facture PDF"
                                    title="Voir la facture"
                                  >
                                    <FileCheck className="h-3.5 w-3.5" />
                                    <span className="hidden sm:inline">Voir la facture</span>
                                  </button>
                                  {sentAt ? (
                                    <button
                                      type="button"
                                      className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5 border-success/40 text-success hover:bg-success/10"
                                      onClick={() => void handleEnvoyerFacture(d)}
                                      disabled={sending || !email}
                                      aria-label="Renvoyer la facture par email"
                                      title={`Envoyée le ${new Date(sentAt).toLocaleString("fr-FR")}`}
                                    >
                                      {sending ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <MailCheck className="h-3.5 w-3.5" />
                                      )}
                                      <span className="hidden sm:inline">✓ Envoyé</span>
                                    </button>
                                  ) : email ? (
                                    <button
                                      type="button"
                                      className="btn-secondary cursor-pointer gap-1.5 px-2 py-1.5 text-xs md:px-2.5"
                                      onClick={() => void handleEnvoyerFacture(d)}
                                      disabled={sending}
                                      aria-label="Envoyer la facture par email"
                                      title={`Envoyer la facture à ${email}`}
                                    >
                                      {sending ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Mail className="h-3.5 w-3.5" />
                                      )}
                                      <span className="hidden sm:inline">Envoyer par email</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-secondary cursor-not-allowed gap-1.5 px-2 py-1.5 text-xs md:px-2.5 opacity-50"
                                      disabled
                                      aria-label="Pas d'email client renseigné"
                                      title="Aucun email client renseigné"
                                    >
                                      <Mail className="h-3.5 w-3.5" />
                                      <span className="hidden sm:inline">Pas d'email</span>
                                    </button>
                                  )}
                                </>
                              );
                            })()}
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
                                  console.error("[drafts-list] téléchargement PDF:", err);
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

      <ClientFormModal
        open={!!creatingForDraft}
        initial={creatingForDraft ? clientUpsertFromDraft(creatingForDraft) : null}
        title="Créer la fiche client"
        submitLabel="Créer et lier au bon"
        onClose={() => setCreatingForDraft(null)}
        onSubmit={handleCreateFromDraft}
      />

      <FactureGenerateModal
        open={!!factureModalDraft}
        draft={factureModalDraft}
        preset="standard"
        onClose={() => setFactureModalDraft(null)}
        onSuccess={() => {
          void refresh();
        }}
      />
    </>
  );
};

export default DraftsListPage;

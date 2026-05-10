import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { User, Car, Wallet, CreditCard, CheckCircle2, Loader2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import ScanCni from "@/components/nouveau-bon/ScanCni";
import VehiculeVente from "@/components/nouveau-bon/VehiculeVente";
import Reglement from "@/components/nouveau-bon/Reglement";
import GenerateBar, { countMissingMandatoryFields } from "@/components/nouveau-bon/GenerateBar";
import { BonFormStepper, computeBonStep } from "@/components/nouveau-bon/BonFormStepper";
import { toast } from "@/hooks/use-toast";
import { usePreferencesFormulaire } from "@/hooks/usePreferencesFormulaire";
import {
  BonDraftData,
  getDraft,
  markDraftSignatureRequestSent,
  upsertDraft,
} from "@/utils/drafts";
import { supabase } from "@/lib/supabase";
import { isFieldEnabled, isStockColumnVisible, type FormFieldPrefs } from "@/utils/formPreferences";
import { cn } from "@/lib/utils";
import {
  getVehicule,
  markVehiculeVenduPourBon,
  vehiculePrixForBon,
  type StockVehicule,
} from "@/utils/stockVehicules";
import {
  attachDraftToClient,
  createClient,
  getClientById,
  searchClients,
  type ClientData,
} from "@/utils/clients";

type DraftFormState = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  vehicleFieldValues: Record<string, string>;
};

const defaultFormState: DraftFormState = {
  id: undefined,
  clientNom: "",
  clientPrenom: "",
  clientDateNaissance: "",
  clientNumeroCni: "",
  clientAdresse: "",
  clientEmail: "",
  vehiculeStockId: "",
  stockDonnees: {},
  stockColonnes: [],
  repriseActive: false,
  reprisePlaque: "",
  repriseMarque: "",
  repriseModele: "",
  repriseVin: "",
  reprisePremiereCirculation: "",
  repriseValeur: "",
  repriseDureeMois: "",
  vehiculePrix: "",
  modePaiement: "comptant",
  acompte: "",
  vehiculeRemise: "",
  vehiculeDateLivraison: "",
  customFieldsValues: {},
  vehicleFieldValues: {},
  documentsScanned: {},
  clientId: null,
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Téléphone saisi dans les champs personnalisés client (clé contenant tel / mobile…). */
function extractClientTelephone(custom: Record<string, string> | undefined): string {
  if (!custom) return "";
  for (const [key, val] of Object.entries(custom)) {
    const v = val?.trim();
    if (!v) continue;
    const nk = stripDiacritics(key);
    if (
      nk.includes("telephone") ||
      nk.includes("tel") ||
      nk.includes("mobile") ||
      nk.includes("phone")
    ) {
      return v;
    }
  }
  return "";
}

function vehiculeTitreFromForm(form: DraftFormState): string {
  const m =
    form.stockDonnees?.modele ||
    form.stockDonnees?.Modele ||
    form.stockDonnees?.MODELE ||
    "";
  const brand =
    form.stockDonnees?.marque ||
    form.stockDonnees?.Marque ||
    form.stockDonnees?.MARQUE ||
    "";
  const parts = [brand, m].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.join(" ") || "Véhicule";
}

type CrmQuickPhase =
  | "idle"
  | "checking"
  | "linked"
  | "exists"
  | "invite"
  | "incomplete"
  | "saving"
  | "saved"
  | "error";

type CrmQuickState = {
  phase: CrmQuickPhase;
  client?: ClientData | null;
  clientId?: string;
  errorMessage?: string;
};

function buildPdfFormData(
  form: DraftFormState,
  prefs: FormFieldPrefs,
): Record<string, string> {
  const repriseOn = form.repriseActive;

  // Filtre les colonnes stock selon les préférences véhicule : une colonne
  // désactivée n'est ni affichée ni injectée dans le PDF.
  const visibleColonnes = (form.stockColonnes ?? []).filter((key) =>
    isStockColumnVisible(key, prefs),
  );
  const visibleDonnees: Record<string, string> = {};
  for (const key of visibleColonnes) {
    if (key in (form.stockDonnees ?? {})) {
      visibleDonnees[key] = form.stockDonnees[key];
    }
  }

  return {
    clientNom: isFieldEnabled(prefs, "clientNom") ? form.clientNom : "",
    clientPrenom: isFieldEnabled(prefs, "clientPrenom") ? form.clientPrenom : "",
    clientDateNaissance: isFieldEnabled(prefs, "clientDateNaissance") ? form.clientDateNaissance : "",
    clientNumeroCni: isFieldEnabled(prefs, "clientNumeroCni") ? form.clientNumeroCni : "",
    clientAdresse: isFieldEnabled(prefs, "clientAdresse") ? form.clientAdresse : "",
    clientEmail: form.clientEmail,
    stock_donnees: JSON.stringify(visibleDonnees),
    stock_colonnes: JSON.stringify(visibleColonnes),
    repriseActive: repriseOn ? "oui" : "non",
    reprise_plaque: repriseOn && isFieldEnabled(prefs, "reprisePlaque") ? form.reprisePlaque : "",
    reprise_marque: repriseOn && isFieldEnabled(prefs, "repriseMarque") ? form.repriseMarque : "",
    reprise_modele: repriseOn && isFieldEnabled(prefs, "repriseModele") ? form.repriseModele : "",
    reprise_vin: repriseOn && isFieldEnabled(prefs, "repriseVin") ? form.repriseVin : "",
    reprise_premiere_circulation:
      repriseOn && isFieldEnabled(prefs, "reprisePremiereCirculation") ? form.reprisePremiereCirculation : "",
    reprise_valeur: repriseOn && isFieldEnabled(prefs, "repriseValeur") ? form.repriseValeur : "",
    reprise_duree_mois: repriseOn && isFieldEnabled(prefs, "repriseDureeMois") ? form.repriseDureeMois : "",
    vehiculePrix: isFieldEnabled(prefs, "vehiculePrix") ? form.vehiculePrix : "",
    modePaiement: isFieldEnabled(prefs, "modePaiement") ? form.modePaiement : "",
    acompte: isFieldEnabled(prefs, "acompte") ? form.acompte : "",
    vehiculeRemise: isFieldEnabled(prefs, "vehiculeRemise") ? form.vehiculeRemise : "",
    vehiculeDateLivraison: isFieldEnabled(prefs, "vehiculeDateLivraison") ? form.vehiculeDateLivraison : "",
    custom_fields_values: JSON.stringify(form.vehicleFieldValues ?? {}),
    custom_fields_defs: JSON.stringify(prefs.fields ?? []),
  };
}

const NouveauBon = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [vendeurEmail, setVendeurEmail] = useState<string>("");
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse">
  >([]);
  /** Affiche la section « Actions rapides » après un flux PDF réussi (GenerateBar). */
  const [postFlowActionsVisible, setPostFlowActionsVisible] = useState(false);
  /** Incrémenté à chaque succès PDF pour relancer les contrôles CRM / stock. */
  const [postGenVersion, setPostGenVersion] = useState(0);
  const [crmQuick, setCrmQuick] = useState<CrmQuickState>({ phase: "idle" });
  const [vehicleStock, setVehicleStock] = useState<StockVehicule | null>(null);
  const [vehicleStockLoading, setVehicleStockLoading] = useState(false);
  const [vehicleMarkedSold, setVehicleMarkedSold] = useState(false);
  const [vehicleMarking, setVehicleMarking] = useState(false);
  const { formPrefs } = usePreferencesFormulaire();

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const email = data.user?.email ?? "";
      if (email) setVendeurEmail(email);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const step = useMemo(
    () => computeBonStep(formState),
    [formState.clientNom, formState.clientPrenom, formState.clientDateNaissance, formState.stockColonnes],
  );

  useEffect(() => {
    if (!params.id) return;
    let cancelled = false;
    (async () => {
      const existing = await getDraft(params.id!);
      if (cancelled || !existing) return;
      const { id, createdAt: _c, updatedAt: _u, ...rest } = existing;
      setFormState({
        ...defaultFormState,
        ...rest,
        vehicleFieldValues: rest.customFieldsValues ?? {},
        id,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    setPostFlowActionsVisible(false);
    setCrmQuick({ phase: "idle" });
    setVehicleStock(null);
    setVehicleStockLoading(false);
    setVehicleMarkedSold(false);
    setVehicleMarking(false);
    setPostGenVersion(0);
  }, [params.id]);

  const handlePostFlowSuccess = useCallback(() => {
    setPostGenVersion((n) => n + 1);
    setPostFlowActionsVisible(true);
  }, []);

  useEffect(() => {
    if (!postFlowActionsVisible) {
      setCrmQuick({ phase: "idle" });
      return;
    }
    const nom = formState.clientNom?.trim() ?? "";
    const prenom = formState.clientPrenom?.trim() ?? "";
    let cancelled = false;
    (async () => {
      if (formState.clientId) {
        setCrmQuick({ phase: "checking" });
        const c = await getClientById(formState.clientId);
        if (cancelled) return;
        setCrmQuick({
          phase: "linked",
          clientId: formState.clientId ?? undefined,
          client: c,
        });
        return;
      }
      if (!nom || !prenom) {
        setCrmQuick({ phase: "incomplete" });
        return;
      }
      setCrmQuick({ phase: "checking" });
      try {
        const list = await searchClients(`${nom} ${prenom}`);
        if (cancelled) return;
        const exact = list.find(
          (c) =>
            c.nom.trim().toLowerCase() === nom.toLowerCase() &&
            c.prenom.trim().toLowerCase() === prenom.toLowerCase(),
        );
        if (exact) {
          setCrmQuick({ phase: "exists", client: exact });
        } else {
          setCrmQuick({ phase: "invite" });
        }
      } catch {
        if (!cancelled) setCrmQuick({ phase: "error", errorMessage: "Impossible de vérifier le CRM." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    postFlowActionsVisible,
    formState.clientId,
    formState.clientNom,
    formState.clientPrenom,
    postGenVersion,
  ]);

  useEffect(() => {
    if (!postFlowActionsVisible) {
      setVehicleStock(null);
      setVehicleStockLoading(false);
      setVehicleMarkedSold(false);
      return;
    }
    const vid = formState.vehiculeStockId?.trim();
    if (!vid) {
      setVehicleStock(null);
      setVehicleStockLoading(false);
      setVehicleMarkedSold(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setVehicleStockLoading(true);
      const v = await getVehicule(vid);
      if (cancelled) return;
      setVehicleStock(v);
      setVehicleMarkedSold(v?.statut === "vendu");
      setVehicleStockLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [postFlowActionsVisible, postGenVersion, formState.vehiculeStockId]);

  // Pré-remplissage depuis le stock : `/nouveau-bon?vehicleId=<uuid>`. On ne
  // déclenche que pour un nouveau bon (pas en mode édition d'un brouillon
  // existant), pour ne pas écraser le contenu chargé. Une fois le véhicule
  // injecté, on nettoie la query string pour éviter de re-injecter à chaque
  // navigation interne.
  useEffect(() => {
    if (params.id) return;
    const search = new URLSearchParams(location.search);
    const vehicleId = search.get("vehicleId");
    if (!vehicleId) return;

    let cancelled = false;
    (async () => {
      const v = await getVehicule(vehicleId);
      if (cancelled) return;
      if (!v) {
        toast({
          title: "Véhicule introuvable",
          description: "Le véhicule sélectionné n'existe plus dans le stock.",
          variant: "destructive",
        });
        navigate("/nouveau-bon", { replace: true });
        return;
      }
      const guessedPrix = vehiculePrixForBon(v);
      setFormState((prev) => ({
        ...prev,
        vehiculeStockId: v.id,
        stockDonnees: { ...v.donnees },
        stockColonnes: [...v.colonnes_pdf],
        vehiculePrix: prev.vehiculePrix || guessedPrix,
      }));
      // Nettoie l'URL pour éviter une nouvelle injection à un re-render.
      navigate("/nouveau-bon", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
    // On ne dépend volontairement que de location.search/params.id : la fonction
    // navigate est stable et l'effet ne doit s'exécuter qu'au montage initial
    // ou si la query string change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, params.id]);

  const updateForm = useCallback((patch: Partial<DraftFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
  }, []);

  const updateCustomField = useCallback((key: string, value: string) => {
    setFormState((prev) => ({
      ...prev,
      customFieldsValues: { ...(prev.customFieldsValues ?? {}), [key]: value },
      vehicleFieldValues: { ...(prev.vehicleFieldValues ?? {}), [key]: value },
    }));
  }, []);

  const handleCniExtracted = useCallback(
    (patch: Partial<BonDraftData>, highlightedFields: Array<keyof BonDraftData>) => {
      setFormState((prev) => ({ ...prev, ...patch }));
      const clientFieldNames = [
        "clientNom",
        "clientPrenom",
        "clientDateNaissance",
        "clientNumeroCni",
        "clientAdresse",
      ] as const;
      const clientOnly = highlightedFields.filter((k): k is (typeof clientFieldNames)[number] =>
        (clientFieldNames as readonly string[]).includes(k as string),
      );
      setAutoFilledClientFields(clientOnly);
    },
    [],
  );

  const handleCniScannedChange = useCallback(
    (state: BonDraftData["documentsScanned"][string] | null) => {
      setFormState((prev) => {
        const next = { ...(prev.documentsScanned ?? {}) };
        if (state) next.cni = state;
        else delete next.cni;
        return { ...prev, documentsScanned: next };
      });
    },
    [],
  );

  const handleManualClientEdit = useCallback(
    (
      field: "clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse",
    ) => {
      setAutoFilledClientFields((prev) => prev.filter((f) => f !== field));
    },
    [],
  );

  const handleSaveDraft = async () => {
    try {
      const saved = await upsertDraft(formState);
      toast({ title: "Brouillon sauvegardé" });
      navigate("/app");
      setFormState((prev) => ({ ...prev, id: saved.id }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Impossible de sauvegarder le brouillon.";
      toast({ title: "Échec de sauvegarde", description: message, variant: "destructive" });
    }
  };

  /**
   * Appelé par GenerateBar après la signature vendeur réussie. Persiste le
   * brouillon avec `signed = true` et `signedAt`. Crée le brouillon s'il
   * n'existait pas encore (cas d'un PDF généré sans sauvegarde manuelle).
   */
  const handleSigned = useCallback(
    async (signedAt: string) => {
      try {
        const saved = await upsertDraft({ ...formState, signed: true, signedAt });
        setFormState((prev) => ({
          ...prev,
          id: saved.id,
          signed: true,
          signedAt,
        }));
        toast({ title: "Bon signé par le vendeur", description: "Le brouillon a été marqué comme signé." });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Impossible d'enregistrer la signature.";
        toast({ title: "Échec d'enregistrement", description: message, variant: "destructive" });
      }
    },
    [formState],
  );

  /**
   * Appelé après envoi de l'email de signature au client : trace le token
   * dans le brouillon pour permettre l'affichage du statut « En attente de
   * signature client » dans le tableau de bord.
   */
  const handleSignatureRequestSent = useCallback(
    async (token: string) => {
      const draftId = formState.id;
      if (!draftId) return;
      const sentAt = new Date().toISOString();
      try {
        await markDraftSignatureRequestSent(draftId, token, sentAt);
        setFormState((prev) => ({
          ...prev,
          signatureRequestToken: token,
          signatureRequestSentAt: sentAt,
        }));
      } catch (err) {
        console.warn("[NouveauBon] markDraftSignatureRequestSent a échoué:", err);
      }
    },
    [formState.id],
  );

  const ensureDraftId = useCallback(async (): Promise<string> => {
    if (formState.id) return formState.id;
    const saved = await upsertDraft(formState);
    setFormState((prev) => ({ ...prev, id: saved.id }));
    return saved.id;
  }, [formState]);

  const handleRegisterClientInCrm = useCallback(async () => {
    const nom = formState.clientNom?.trim();
    const prenom = formState.clientPrenom?.trim();
    if (!nom || !prenom) {
      toast({
        title: "Nom et prénom requis",
        description: "Complétez l'identité client avant d'enregistrer la fiche.",
        variant: "destructive",
      });
      return;
    }
    setCrmQuick((s) => ({ ...s, phase: "saving" }));
    try {
      const draftId = await ensureDraftId();
      const tel = extractClientTelephone(formState.customFieldsValues);
      const created = await createClient({
        nom,
        prenom,
        email: formState.clientEmail?.trim() || "",
        telephone: tel,
        dateNaissance: formState.clientDateNaissance?.trim() || "",
      });
      await attachDraftToClient(draftId, created.id);
      setFormState((prev) => ({ ...prev, id: draftId, clientId: created.id }));
      setCrmQuick({ phase: "saved", client: created, clientId: created.id });
      toast({
        title: "Client enregistré",
        description: "La fiche a été créée et liée à ce bon de commande.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Impossible d'enregistrer le client.";
      setCrmQuick({ phase: "invite" });
      toast({ title: "CRM", description: msg, variant: "destructive" });
    }
  }, [formState, ensureDraftId]);

  const handleLinkExistingClientToDraft = useCallback(
    async (client: ClientData) => {
      try {
        const draftId = await ensureDraftId();
        await attachDraftToClient(draftId, client.id);
        setFormState((prev) => ({ ...prev, id: draftId, clientId: client.id }));
        setCrmQuick({ phase: "linked", client, clientId: client.id });
        toast({ title: "Bon lié", description: "Ce brouillon est rattaché à la fiche client." });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Liaison impossible.";
        toast({ title: "CRM", description: msg, variant: "destructive" });
      }
    },
    [ensureDraftId],
  );

  const handleMarkStockVehicleSold = useCallback(async () => {
    const vid = formState.vehiculeStockId?.trim();
    if (!vid) return;
    if (
      !window.confirm(
        "Marquer ce véhicule comme vendu dans le stock ? Il n'apparaîtra plus comme disponible.",
      )
    ) {
      return;
    }
    setVehicleMarking(true);
    try {
      const ok = await markVehiculeVenduPourBon(vid);
      if (!ok) throw new Error("Mise à jour refusée ou véhicule introuvable.");
      setVehicleMarkedSold(true);
      setVehicleStock((prev) =>
        prev ? { ...prev, statut: "vendu", disponible: false } : prev,
      );
      toast({ title: "Stock mis à jour", description: "Le véhicule est marqué comme vendu." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de la mise à jour.";
      toast({ title: "Stock", description: msg, variant: "destructive" });
    } finally {
      setVehicleMarking(false);
    }
  }, [formState.vehiculeStockId]);

  const clientDisplayName =
    `${formState.clientPrenom ?? ""} ${formState.clientNom ?? ""}`.trim() || "le client";
  const vehiculeQuickLabel =
    vehicleStock && (vehicleStock.marque || vehicleStock.modele)
      ? [vehicleStock.marque, vehicleStock.modele].filter(Boolean).join(" ")
      : vehiculeTitreFromForm(formState);

  return (
    <>
      <TopBar
        title="Nouveau bon de commande"
        subtitle="Renseignez le client, le véhicule et le règlement"
        actions={
          <>
            <button
              type="button"
              className="btn-secondary hidden cursor-pointer sm:inline-flex"
              onClick={() => navigate("/app")}
            >
              Annuler
            </button>
            <button type="button" className="btn-primary cursor-pointer border-0" onClick={handleSaveDraft}>
              Sauvegarder
            </button>
          </>
        }
      />
      <div className="page-shell">
        <div className="page-content pb-32 md:pb-7">
          <div className="mb-5 space-y-4">
            <BonFormStepper current={step} />
            <p className="text-center text-xs text-muted-foreground sm:text-left">
              Étape suggérée selon la complétion du formulaire (étape {step}/3)
            </p>
          </div>

          <div className="mb-4 space-y-5 md:mb-5">
            <div className="card-autodocs border-primary/20">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/15 text-primary">
                  <User className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold text-foreground">Client</h2>
                  <p className="text-xs text-muted-foreground">Identité & coordonnées</p>
                </div>
              </div>
              <div className="space-y-5">
                <ScanCni
                  initialScan={formState.documentsScanned?.cni}
                  onScannedChange={handleCniScannedChange}
                  onExtracted={handleCniExtracted}
                />
                <ProfilClient
                  form={formState}
                  onChange={updateForm}
                  autoFilledFields={autoFilledClientFields}
                  onManualEditField={handleManualClientEdit}
                  prefs={formPrefs}
                  customValues={formState.customFieldsValues}
                  onCustomFieldChange={updateCustomField}
                />
              </div>
            </div>

            <div className="card-autodocs border-primary/20">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/15 text-primary">
                  <Car className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold text-foreground">Véhicule</h2>
                  <p className="text-xs text-muted-foreground">Stock & reprise</p>
                </div>
              </div>
              <VehiculeVente
                form={formState}
                onChange={updateForm}
                prefs={formPrefs}
                customValues={formState.customFieldsValues}
                onCustomFieldChange={updateCustomField}
              />
            </div>

            <div className="card-autodocs border-primary/20">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/15 text-primary">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-sm font-bold text-foreground">Règlement</h2>
                  <p className="text-xs text-muted-foreground">Prix, remise, livraison</p>
                </div>
              </div>
              <Reglement
                form={formState}
                onChange={updateForm}
                prefs={formPrefs}
                customValues={formState.customFieldsValues}
                onCustomFieldChange={updateCustomField}
              />
            </div>

            {postFlowActionsVisible ? (
              <div className="card-autodocs border border-primary/30 bg-[#1A1D27] shadow-[0_0_0_1px_rgba(99,102,241,0.12)]">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-sm font-bold text-foreground">Actions rapides</h2>
                    <p className="text-xs text-muted-foreground">
                      Suite à la génération du bon — vous pouvez ignorer cette étape.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer px-3 py-2 text-xs"
                    onClick={() => setPostFlowActionsVisible(false)}
                  >
                    Passer
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {/* CRM */}
                  <div className="flex flex-col rounded-xl border border-border/80 bg-card/60 p-4">
                    <div className="mb-2 flex items-center gap-2 text-primary">
                      <User className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        CRM
                      </span>
                    </div>
                    {crmQuick.phase === "checking" ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                        Vérification…
                      </div>
                    ) : crmQuick.phase === "incomplete" ? (
                      <p className="text-sm text-muted-foreground">
                        Renseignez le nom et le prénom du client pour proposer l&apos;enregistrement CRM.
                      </p>
                    ) : crmQuick.phase === "linked" || crmQuick.phase === "saved" ? (
                      <div className="flex flex-1 flex-col gap-3">
                        <p className="text-sm font-medium text-foreground">
                          Client déjà enregistré{" "}
                          <span className="text-success" aria-hidden>
                            ✓
                          </span>
                        </p>
                        {(crmQuick.clientId ?? crmQuick.client?.id) && (
                          <Link
                            to={`/clients/${crmQuick.clientId ?? crmQuick.client?.id}`}
                            className="inline-flex text-sm font-semibold text-primary hover:underline"
                          >
                            Voir la fiche client
                          </Link>
                        )}
                      </div>
                    ) : crmQuick.phase === "exists" && crmQuick.client ? (
                      <div className="flex flex-1 flex-col gap-3">
                        <p className="text-sm text-foreground">
                          Un client{" "}
                          <span className="font-semibold">
                            {crmQuick.client.prenom} {crmQuick.client.nom}
                          </span>{" "}
                          existe déjà avec le même nom et prénom.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Client déjà enregistré
                          </span>
                          <Link
                            to={`/clients/${crmQuick.client.id}`}
                            className="text-sm font-semibold text-primary hover:underline"
                          >
                            Voir la fiche
                          </Link>
                        </div>
                        {formState.clientId !== crmQuick.client.id ? (
                          <button
                            type="button"
                            className="btn-secondary mt-1 cursor-pointer text-xs"
                            onClick={() => void handleLinkExistingClientToDraft(crmQuick.client!)}
                          >
                            Lier ce bon à cette fiche
                          </button>
                        ) : null}
                      </div>
                    ) : crmQuick.phase === "invite" || crmQuick.phase === "saving" ? (
                      <div className="flex flex-1 flex-col gap-3">
                        <p className="text-sm text-foreground">
                          Voulez-vous enregistrer{" "}
                          <span className="font-semibold text-primary">{clientDisplayName}</span> dans
                          vos clients ?
                        </p>
                        <button
                          type="button"
                          className="btn-primary cursor-pointer border-0 text-sm"
                          disabled={crmQuick.phase === "saving"}
                          onClick={() => void handleRegisterClientInCrm()}
                        >
                          {crmQuick.phase === "saving" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Enregistrement…
                            </>
                          ) : (
                            "Enregistrer comme client"
                          )}
                        </button>
                      </div>
                    ) : crmQuick.phase === "error" ? (
                      <p className="text-sm text-destructive">{crmQuick.errorMessage}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">—</p>
                    )}
                  </div>

                  {/* Stock vendu */}
                  <div className="flex flex-col rounded-xl border border-border/80 bg-card/60 p-4">
                    <div className="mb-2 flex items-center gap-2 text-primary">
                      <Car className="h-5 w-5 shrink-0" aria-hidden />
                      <span className="font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Stock
                      </span>
                    </div>
                    {!formState.vehiculeStockId?.trim() ? (
                      <p className="text-sm text-muted-foreground">
                        Aucun véhicule issu du stock n&apos;est lié à ce bon (saisie manuelle ou reprise
                        uniquement).
                      </p>
                    ) : vehicleStockLoading ? (
                      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                        Chargement du véhicule…
                      </div>
                    ) : (
                      <div className="flex flex-1 flex-col gap-3">
                        <p className="text-sm text-foreground">
                          Marquer{" "}
                          <span className="font-semibold text-primary">{vehiculeQuickLabel}</span> comme
                          vendu dans votre stock ?
                        </p>
                        <button
                          type="button"
                          disabled={vehicleMarkedSold || vehicleMarking}
                          onClick={() => void handleMarkStockVehicleSold()}
                          className={cn(
                            "inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border-0 px-4 py-2.5 font-display text-sm font-bold transition-all",
                            vehicleMarkedSold
                              ? "bg-success/20 text-success ring-1 ring-success/40 cursor-default"
                              : "btn-primary border-0",
                          )}
                        >
                          {vehicleMarking ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Mise à jour…
                            </>
                          ) : vehicleMarkedSold ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              Vendu ✓
                            </>
                          ) : (
                            "Marquer comme vendu"
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="text-muted-foreground hidden items-center justify-center gap-2 text-xs sm:flex">
            <CreditCard className="h-3.5 w-3.5" />
            Les données servent à générer le bon de commande PDF
          </div>
        </div>
      </div>

      <GenerateBar
        documentsUploaded={0}
        missingFieldsCount={countMissingMandatoryFields(formState as Record<string, unknown>)}
        formData={buildPdfFormData(formState, formPrefs)}
        clientEmail={formState.clientEmail}
        clientNom={formState.clientNom}
        clientPrenom={formState.clientPrenom}
        vehiculeModele={
          formState.stockDonnees?.modele ||
          formState.stockDonnees?.Modele ||
          formState.stockDonnees?.MODELE ||
          "Véhicule"
        }
        vendeurNom="Votre conseiller"
        vendeurEmail={vendeurEmail}
        brouillonId={formState.id}
        templateId=""
        onSigned={handleSigned}
        onSignatureRequestSent={handleSignatureRequestSent}
        onFlowSuccess={handlePostFlowSuccess}
      />
    </>
  );
};

export default NouveauBon;

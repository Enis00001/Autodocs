import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  User,
  Car,
  Wallet,
  CreditCard,
  CheckCircle2,
  Loader2,
  Receipt,
  Search,
  X,
  Circle,
  AlertTriangle,
  FileText,
} from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import ScanCni from "@/components/nouveau-bon/ScanCni";
import VehiculeVente, { type RepriseEstimationAi } from "@/components/nouveau-bon/VehiculeVente";
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
} from "@/utils/stockVehicules";
import {
  attachDraftToClient,
  clientUpsertFromDraft,
  createClient,
  findClientExactNomPrenom,
  searchClientsAutocomplete,
  type ClientData,
} from "@/utils/clients";
import FactureGenerateModal from "@/components/FactureGenerateModal";
import { getFactureByBrouillonId } from "@/utils/factures";
import { downloadBase64Pdf } from "@/utils/generatePDF";
import type { GenerateBarSuccessPayload } from "@/components/nouveau-bon/GenerateBar";
import { apiFetch } from "@/lib/apiClient";

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
  clientTelephone: "",
  vehiculeStockId: "",
  stockDonnees: {},
  stockColonnes: [],
  repriseActive: false,
  reprisePlaque: "",
  repriseMarque: "",
  repriseModele: "",
  repriseVin: "",
  reprisePremiereCirculation: "",
  repriseKilometrage: "",
  repriseEnergie: "",
  repriseVersion: "",
  repriseValeur: "",
  repriseDureeMois: "",
  vehiculePrix: "",
  modePaiement: "comptant",
  acompte: "",
  vehiculeRemise: "",
  vehiculeDateLivraison: "",
  customFieldsValues: {},
  cerfaVinComplement: "",
  cerfaFormuleCarteGrise: "",
  cerfaAcheteurCivilite: "m",
  cerfaAcheteurCodePostal: "",
  cerfaAcheteurVille: "",
  cerfaAcheteurLieuNaissance: "",
  vehicleFieldValues: {},
  documentsScanned: {},
  clientId: null,
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Téléphone issu des champs personnalisés client (clé contenant tel / mobile…). */
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

/** Première métadonnée de champ personnalisé « client » dont la clé ou le libellé évoque un téléphone. */
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

/** Copie du formulaire au moment où la popup GenerateBar se ferme après succès. */
function snapshotDraftForm(fs: DraftFormState): DraftFormState {
  return {
    ...fs,
    stockDonnees: { ...fs.stockDonnees },
    stockColonnes: [...(fs.stockColonnes ?? [])],
    customFieldsValues: { ...fs.customFieldsValues },
    vehicleFieldValues: { ...fs.vehicleFieldValues },
    documentsScanned: { ...fs.documentsScanned },
  };
}

/** Prépare un snapshot pour `upsertDraft` (fusion vehicleFieldValues → customFieldsValues). */
function closureSnapshotForUpsert(ds: DraftFormState): Parameters<typeof upsertDraft>[0] {
  const { vehicleFieldValues, ...base } = ds;
  return {
    ...base,
    customFieldsValues: {
      ...(base.customFieldsValues ?? {}),
      ...(vehicleFieldValues ?? {}),
    },
  };
}

type ClosurePayload = {
  draftSnapshot: DraftFormState;
  vehiculeDisplayLabel: string;
};

type ClosureCrmUi =
  | "idle"
  | "linked_snapshot"
  | "checking"
  | "already_db"
  | "saving"
  | "saved";

type PostAgentDelegateCtx = {
  draftSnapshot: DraftFormState;
  vehiculeDisplayLabel: string;
  pdfBase64: string;
  signatureVendeurBase64: string | null;
  formData: Record<string, string>;
  emailDejaEnvoye: boolean;
};

type AgentTachesState = {
  enregistrer_client: boolean;
  envoyer_bon_email: boolean;
  generer_facture: boolean;
  envoyer_facture_email: boolean;
  marquer_vendu: boolean;
  generer_cerfa: boolean;
  livre_police: boolean;
};

type LivrePoliceDataState = {
  prix_achat: string;
  genre: string;
  pays_origine: string;
};

const defaultLivrePoliceData = (): LivrePoliceDataState => ({
  prix_achat: "",
  genre: "VP",
  pays_origine: "France",
});

type AgentRapportLigne = {
  tache: string;
  statut: "ok" | "err" | "warn" | "skip";
  message: string;
  pdf_base64?: string;
};

function guessVinFromStockDonnees(sd: Record<string, string>): string {
  const keys = ["vin", "VIN", "chassis", "châssis", "numero_serie", "n_serie", "serie"];
  for (const k of keys) {
    const v = String(sd[k] ?? "").trim();
    if (v) return v.replace(/\s+/g, "").slice(0, 17);
  }
  return "";
}

function guessFormuleFromStockDonnees(sd: Record<string, string>): string {
  const keys = [
    "formule",
    "numero_formule",
    "numéro_formule",
    "n_formule",
    "numero_formule_carte_grise",
    "carte_grise_formule",
  ];
  for (const k of keys) {
    const v = String(sd[k] ?? "").trim();
    if (v) return v.replace(/\s+/g, "").slice(0, 9);
  }
  return "";
}

function defaultAgentTaches(clientEmailTrim: string): AgentTachesState {
  return {
    enregistrer_client: true,
    envoyer_bon_email: true,
    generer_facture: true,
    envoyer_facture_email: true,
    marquer_vendu: true,
    generer_cerfa: false,
    livre_police: true,
  };
}

function buildAgentProgressOrder(t: AgentTachesState): { id: string; label: string }[] {
  const rows: { id: string; label: string }[] = [
    { id: "analyse", label: "Données analysées" },
  ];
  if (t.enregistrer_client) {
    rows.push({ id: "client", label: "Fiche client enregistrée" });
  }
  if (t.envoyer_bon_email) {
    rows.push({ id: "bon_email", label: "Envoi du bon par email" });
  }
  if (t.generer_facture) {
    rows.push({ id: "facture", label: "Génération de la facture" });
  }
  if (t.envoyer_facture_email && t.generer_facture) {
    rows.push({ id: "facture_email", label: "Envoi facture par email" });
  }
  if (t.marquer_vendu) {
    rows.push({ id: "vendu", label: "Véhicule marqué comme vendu" });
  }
  if (t.livre_police) {
    rows.push({ id: "livre_police", label: "Entrée livre de police créée" });
  }
  if (t.generer_cerfa) {
    rows.push({ id: "cerfa", label: "Génération CERFA" });
  }
  return rows;
}

function buildPdfFormData(
  form: DraftFormState,
  prefs: FormFieldPrefs,
): Record<string, string> {
  const repriseOn = form.repriseActive;

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
    /** Facture / CRM uniquement — jamais sur le PDF bon. */
    clientAdresse: "",
    clientEmail: "",
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
  const formStateRef = useRef(formState);
  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const [vendeurEmail, setVendeurEmail] = useState<string>("");
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientAdresse">
  >([]);
  /** Badge « Extrait par IA » sur le N° CNI (section infos complémentaires), indépendant des champs identité. */
  const [numeroCniExtraitParIa, setNumeroCniExtraitParIa] = useState(false);

  const [crmSearchInput, setCrmSearchInput] = useState("");
  const [crmSearchDebounced, setCrmSearchDebounced] = useState("");
  const [crmSearchResults, setCrmSearchResults] = useState<ClientData[]>([]);
  const [crmSearchLoading, setCrmSearchLoading] = useState(false);
  const [crmPickerOpen, setCrmPickerOpen] = useState(false);
  const crmSearchWrapRef = useRef<HTMLDivElement>(null);

  /** Modal « Clôturer la vente » — ouverte après fermeture de la popup GenerateBar en succès. */
  const [closureModalOpen, setClosureModalOpen] = useState(false);
  const [closurePayload, setClosurePayload] = useState<ClosurePayload | null>(null);
  const [closureVehicleLoading, setClosureVehicleLoading] = useState(false);
  const [closureSoldDone, setClosureSoldDone] = useState(false);
  const [closureSoldSaving, setClosureSoldSaving] = useState(false);
  const [closureCrmUi, setClosureCrmUi] = useState<ClosureCrmUi>("idle");

  /** Facture — modal et état carte dans la popup de clôture */
  const [closureFactureModalOpen, setClosureFactureModalOpen] = useState(false);
  const [closureFactureDraft, setClosureFactureDraft] = useState<BonDraftData | null>(
    null,
  );
  const [closureFactureOpening, setClosureFactureOpening] = useState(false);
  const [closureFactureDone, setClosureFactureDone] = useState<{
    numero_facture: string;
    pdfBase64: string;
  } | null>(null);

  /** Card « Déléguer à l’agent IA » après succès GenerateBar, avant la popup de clôture. */
  const [postAgentOpen, setPostAgentOpen] = useState(false);
  const [postAgentCtx, setPostAgentCtx] = useState<PostAgentDelegateCtx | null>(null);
  const [postAgentPhase, setPostAgentPhase] = useState<"pick" | "run" | "summary">("pick");
  const [postAgentTaches, setPostAgentTaches] = useState<AgentTachesState>(() =>
    defaultAgentTaches(""),
  );
  /** Refs : évite une valeur « figée » des tâches au clic « Lancer l'agent ». */
  const tachesRef = useRef<AgentTachesState>(defaultAgentTaches(""));
  const [livrePoliceData, setLivrePoliceData] = useState<LivrePoliceDataState>(() =>
    defaultLivrePoliceData(),
  );
  const livrePoliceRef = useRef<LivrePoliceDataState>(defaultLivrePoliceData());
  const [postAgentRunOrder, setPostAgentRunOrder] = useState<{ id: string; label: string }[]>([]);
  const [postAgentRunStepIdx, setPostAgentRunStepIdx] = useState(0);
  const [postAgentRapport, setPostAgentRapport] = useState<AgentRapportLigne[]>([]);
  const [postAgentDurationMs, setPostAgentDurationMs] = useState(0);

  useEffect(() => {
    tachesRef.current = postAgentTaches;
  }, [postAgentTaches]);

  useEffect(() => {
    livrePoliceRef.current = livrePoliceData;
  }, [livrePoliceData]);

  const [repriseEstimationLoading, setRepriseEstimationLoading] = useState(false);
  const [repriseEstimation, setRepriseEstimation] = useState<RepriseEstimationAi | null>(null);

  const { formPrefs } = usePreferencesFormulaire();

  useEffect(() => {
    const t = window.setTimeout(() => setCrmSearchDebounced(crmSearchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [crmSearchInput]);

  useEffect(() => {
    if (!crmSearchDebounced) {
      setCrmSearchResults([]);
      setCrmSearchLoading(false);
      return;
    }
    let cancelled = false;
    setCrmSearchLoading(true);
    void searchClientsAutocomplete(crmSearchDebounced).then((rows) => {
      if (cancelled) return;
      setCrmSearchResults(rows);
      setCrmSearchLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [crmSearchDebounced]);

  useEffect(() => {
    function onDocMouseDown(ev: MouseEvent) {
      if (!crmSearchWrapRef.current?.contains(ev.target as Node)) {
        setCrmPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

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
      setNumeroCniExtraitParIa(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    setClosureModalOpen(false);
    setClosurePayload(null);
    setClosureVehicleLoading(false);
    setClosureSoldDone(false);
    setClosureSoldSaving(false);
    setClosureCrmUi("idle");
    setClosureFactureModalOpen(false);
    setClosureFactureDraft(null);
    setClosureFactureDone(null);
    setClosureFactureOpening(false);
    setPostAgentOpen(false);
    setPostAgentCtx(null);
    setPostAgentPhase("pick");
    const routeResetTaches = defaultAgentTaches("");
    setPostAgentTaches(routeResetTaches);
    tachesRef.current = routeResetTaches;
    setPostAgentRunOrder([]);
    setPostAgentRunStepIdx(0);
    setPostAgentRapport([]);
    setPostAgentDurationMs(0);
    const resetLp = defaultLivrePoliceData();
    setLivrePoliceData(resetLp);
    livrePoliceRef.current = resetLp;
    setRepriseEstimation(null);
    setRepriseEstimationLoading(false);
    setNumeroCniExtraitParIa(false);
  }, [params.id]);

  const openClosureModalWithState = useCallback((state: DraftFormState) => {
    setClosurePayload({
      draftSnapshot: snapshotDraftForm(state),
      vehiculeDisplayLabel: vehiculeTitreFromForm(state),
    });
    setClosureCrmUi(state.clientId ? "linked_snapshot" : "idle");
    setClosureSoldDone(false);
    setClosureSoldSaving(false);
    setClosureFactureDone(null);
    setClosureFactureModalOpen(false);
    setClosureFactureDraft(null);
    setClosureModalOpen(true);
  }, []);

  const handleSuccessfulModalClosed = useCallback((payload: GenerateBarSuccessPayload) => {
    const fs = formStateRef.current;
    const snapshot = snapshotDraftForm(fs);

    void (async () => {
      try {
        const saved = await upsertDraft(closureSnapshotForUpsert(snapshot));
        const nextState: DraftFormState = {
          ...snapshot,
          id: saved.id,
        };
        setFormState((prev) => ({ ...prev, id: saved.id }));
        const t = toast({
          title: "Bon sauvegardé automatiquement ✓",
          description: "Le brouillon a été mis à jour.",
        });
        window.setTimeout(() => t.dismiss(), 3000);
        const snap = snapshotDraftForm(nextState);
        setPostAgentCtx({
          draftSnapshot: snap,
          vehiculeDisplayLabel: vehiculeTitreFromForm(nextState),
          pdfBase64: payload.pdfBase64,
          signatureVendeurBase64: payload.signatureVendeurBase64,
          formData: { ...payload.formData },
          emailDejaEnvoye: payload.emailDejaEnvoye,
        });
        const nextTachesOk = defaultAgentTaches((snap.clientEmail ?? "").trim());
        setPostAgentTaches(nextTachesOk);
        tachesRef.current = nextTachesOk;
        setPostAgentPhase("pick");
        setPostAgentRapport([]);
        setPostAgentDurationMs(0);
        setPostAgentOpen(true);
      } catch (err) {
        console.error("Erreur sauvegarde auto:", err);
        const snap = snapshotDraftForm(snapshot);
        setPostAgentCtx({
          draftSnapshot: snap,
          vehiculeDisplayLabel: vehiculeTitreFromForm(snapshot),
          pdfBase64: payload.pdfBase64,
          signatureVendeurBase64: payload.signatureVendeurBase64,
          formData: { ...payload.formData },
          emailDejaEnvoye: payload.emailDejaEnvoye,
        });
        const nextTachesErr = defaultAgentTaches((snap.clientEmail ?? "").trim());
        setPostAgentTaches(nextTachesErr);
        tachesRef.current = nextTachesErr;
        setPostAgentPhase("pick");
        setPostAgentOpen(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!closureModalOpen || !closurePayload?.draftSnapshot.id?.trim()) {
      setClosureFactureDone(null);
      return;
    }
    const bid = closurePayload.draftSnapshot.id.trim();
    let cancelled = false;
    void getFactureByBrouillonId(bid).then((f) => {
      if (cancelled || !f?.pdf_base64) return;
      setClosureFactureDone({
        numero_facture: f.numero_facture,
        pdfBase64: f.pdf_base64,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [closureModalOpen, closurePayload?.draftSnapshot.id]);

  const handleClosureOpenFactureModal = useCallback(async () => {
    if (!closurePayload) return;
    setClosureFactureOpening(true);
    try {
      let draftId = closurePayload.draftSnapshot.id?.trim();
      if (!draftId) {
        const saved = await upsertDraft(closureSnapshotForUpsert(closurePayload.draftSnapshot));
        draftId = saved.id;
        setFormState((prev) => ({ ...prev, id: saved.id }));
        setClosurePayload((prev) =>
          prev
            ? {
                ...prev,
                draftSnapshot: { ...prev.draftSnapshot, id: saved.id },
              }
            : null,
        );
      }
      const d = await getDraft(draftId);
      if (!d) {
        toast({
          title: "Brouillon introuvable",
          description: "Impossible de recharger le bon après enregistrement.",
          variant: "destructive",
        });
        return;
      }
      setClosureFactureDraft(d);
      setClosureFactureModalOpen(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Impossible de préparer la facture.";
      toast({ title: "Facture", description: msg, variant: "destructive" });
    } finally {
      setClosureFactureOpening(false);
    }
  }, [closurePayload]);

  useEffect(() => {
    if (!closureModalOpen || !closurePayload) return;
    const vid = closurePayload.draftSnapshot.vehiculeStockId?.trim();
    if (!vid) {
      setClosureVehicleLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setClosureVehicleLoading(true);
      const v = await getVehicule(vid);
      if (cancelled) return;
      setClosureSoldDone(
        !!v && (!v.disponible || v.statut === "vendu"),
      );
      setClosureVehicleLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [closureModalOpen, closurePayload]);

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
      navigate("/nouveau-bon", { replace: true });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, params.id]);

  const updateForm = useCallback((patch: Partial<DraftFormState>) => {
    if (patch.repriseActive === false) {
      setRepriseEstimation(null);
    }
    setFormState((prev) => ({ ...prev, ...patch }));
  }, []);

  const estimerReprise = useCallback(async () => {
    setRepriseEstimationLoading(true);
    setRepriseEstimation(null);
    try {
      const fs = formStateRef.current;
      const response = await apiFetch("/api/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "estimer-reprise",
          marque: fs.repriseMarque,
          modele: fs.repriseModele,
          kilometrage: fs.repriseKilometrage,
          annee: fs.reprisePremiereCirculation,
          energie: fs.repriseEnergie,
          version: fs.repriseVersion,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        estimation?: RepriseEstimationAi;
        error?: string;
      };
      if (!response.ok) {
        toast({
          title: "Estimation IA",
          description: data.error ?? "Une erreur est survenue.",
          variant: "destructive",
        });
        return;
      }
      if (data.estimation) {
        setRepriseEstimation(data.estimation);
      }
    } catch (err) {
      console.error("Erreur estimation:", err);
      toast({
        title: "Estimation IA",
        description: err instanceof Error ? err.message : "Erreur réseau.",
        variant: "destructive",
      });
    } finally {
      setRepriseEstimationLoading(false);
    }
  }, []);

  /** Pré-remplit VIN / formule CERFA depuis le stock si les champs sont encore vides. */
  useEffect(() => {
    setFormState((fs) => {
      if (!fs.vehiculeStockId?.trim()) return fs;
      const patch: Partial<DraftFormState> = {};
      const vinStock = guessVinFromStockDonnees(fs.stockDonnees ?? {});
      if (!(fs.cerfaVinComplement ?? "").trim() && vinStock) patch.cerfaVinComplement = vinStock;
      const fStock = guessFormuleFromStockDonnees(fs.stockDonnees ?? {});
      if (!(fs.cerfaFormuleCarteGrise ?? "").trim() && fStock)
        patch.cerfaFormuleCarteGrise = fStock;
      return Object.keys(patch).length ? { ...fs, ...patch } : fs;
    });
  }, [formState.vehiculeStockId, formState.stockDonnees]);

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
      setNumeroCniExtraitParIa(highlightedFields.includes("clientNumeroCni"));
      const clientFieldNames = [
        "clientNom",
        "clientPrenom",
        "clientDateNaissance",
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
    (field: "clientNom" | "clientPrenom" | "clientDateNaissance" | "clientAdresse") => {
      setAutoFilledClientFields((prev) => prev.filter((f) => f !== field));
    },
    [],
  );

  const handleCrmClientSelect = useCallback((c: ClientData) => {
    const civRaw = (c.civilite ?? "m").toLowerCase().trim();
    const cerfaAcheteurCivilite: "m" | "mme" | "morale" =
      civRaw === "mme" || civRaw === "f"
        ? "mme"
        : civRaw === "morale" || civRaw === "pm" || civRaw === "personne_morale"
          ? "morale"
          : "m";
    setFormState((prev) => ({
      ...prev,
      clientId: c.id,
      clientNom: c.nom ?? "",
      clientPrenom: c.prenom ?? "",
      clientDateNaissance: c.dateNaissance ?? "",
      clientNumeroCni: c.numeroCni?.trim() ?? "",
      clientEmail: c.email ?? "",
      clientTelephone: c.telephone?.trim() ?? "",
      clientAdresse: c.adresse?.trim() ?? "",
      cerfaAcheteurCodePostal: c.codePostal?.trim() ?? "",
      cerfaAcheteurVille: c.ville?.trim() ?? "",
      cerfaAcheteurLieuNaissance: c.lieuNaissance?.trim() ?? "",
      cerfaAcheteurCivilite,
    }));
    setAutoFilledClientFields([]);
    setNumeroCniExtraitParIa(false);
    setCrmSearchInput("");
    setCrmSearchResults([]);
    setCrmPickerOpen(false);
  }, []);

  const handleCrmClientClear = useCallback(() => {
    setFormState((prev) => ({ ...prev, clientId: null }));
    setCrmSearchInput("");
    setCrmSearchResults([]);
    setCrmPickerOpen(false);
  }, []);

  const crmSelectedLabel =
    `${formState.clientPrenom ?? ""} ${formState.clientNom ?? ""}`.trim() || "Client";

  const showCrmDropdown =
    !formState.clientId && crmPickerOpen && (!!crmSearchDebounced || crmSearchLoading);

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

  const handleClosureMarkSold = useCallback(async () => {
    if (!closurePayload) return;
    const vid = closurePayload.draftSnapshot.vehiculeStockId?.trim();
    if (!vid || closureSoldDone || closureSoldSaving) return;
    setClosureSoldSaving(true);
    try {
      const ok = await markVehiculeVenduPourBon(vid);
      if (!ok) throw new Error("Mise à jour refusée ou véhicule introuvable.");
      setClosureSoldDone(true);
      toast({ title: "Stock mis à jour", description: "Le véhicule est marqué comme vendu." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur lors de la mise à jour.";
      toast({ title: "Stock", description: msg, variant: "destructive" });
    } finally {
      setClosureSoldSaving(false);
    }
  }, [closurePayload, closureSoldDone, closureSoldSaving]);

  const handleClosureRegisterCrm = useCallback(async () => {
    if (!closurePayload) return;
    const ds = closurePayload.draftSnapshot;
    const nom = ds.clientNom?.trim();
    const prenom = ds.clientPrenom?.trim();
    if (!nom || !prenom) {
      toast({
        title: "Nom et prénom requis",
        description: "Complétez l'identité client avant d'enregistrer la fiche.",
        variant: "destructive",
      });
      return;
    }
    if (
      closureCrmUi === "linked_snapshot" ||
      closureCrmUi === "already_db" ||
      closureCrmUi === "saved"
    ) {
      return;
    }

    setClosureCrmUi("checking");
    try {
      const existing = await findClientExactNomPrenom(nom, prenom);
      if (existing) {
        setClosureCrmUi("already_db");
        return;
      }
      setClosureCrmUi("saving");
      let draftId = ds.id;
      if (!draftId) {
        const saved = await upsertDraft(closureSnapshotForUpsert(ds));
        draftId = saved.id;
      }
      const { vehicleFieldValues: _vf, ...draftSansVf } = ds;
      const base = clientUpsertFromDraft(draftSansVf as BonDraftData);
      const tel =
        ds.clientTelephone?.trim() ||
        extractClientTelephone(ds.customFieldsValues);
      const created = await createClient({
        ...base,
        telephone: tel || base.telephone || "",
      });
      await attachDraftToClient(draftId, created.id);
      setFormState((prev) => ({ ...prev, id: draftId, clientId: created.id }));
      setClosureCrmUi("saved");
      toast({
        title: "Client enregistré",
        description: "La fiche CRM est créée et liée au brouillon.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Impossible d'enregistrer le client.";
      setClosureCrmUi("idle");
      toast({ title: "CRM", description: msg, variant: "destructive" });
    }
  }, [closurePayload, closureCrmUi]);

  const handleClosureFermer = useCallback(() => {
    setClosureModalOpen(false);
    setClosurePayload(null);
    setClosureCrmUi("idle");
    setClosureSoldDone(false);
    setClosureSoldSaving(false);
    setClosureVehicleLoading(false);
    setClosureFactureModalOpen(false);
    setClosureFactureDraft(null);
    setClosureFactureDone(null);
    setClosureFactureOpening(false);
    setPostAgentOpen(false);
    setPostAgentCtx(null);
    setPostAgentPhase("pick");
    const fermerTaches = defaultAgentTaches("");
    setPostAgentTaches(fermerTaches);
    tachesRef.current = fermerTaches;
    setPostAgentRunOrder([]);
    setPostAgentRunStepIdx(0);
    setPostAgentRapport([]);
    setPostAgentDurationMs(0);
    const fermerLp = defaultLivrePoliceData();
    setLivrePoliceData(fermerLp);
    livrePoliceRef.current = fermerLp;
    setRepriseEstimation(null);
    setRepriseEstimationLoading(false);
    setFormState({ ...defaultFormState });
    setAutoFilledClientFields([]);
    setNumeroCniExtraitParIa(false);
    navigate("/nouveau-bon", { replace: true });
  }, [navigate]);

  const handlePostAgentManual = useCallback(() => {
    if (!postAgentCtx) return;
    const snap = postAgentCtx.draftSnapshot;
    setPostAgentOpen(false);
    setPostAgentCtx(null);
    setPostAgentPhase("pick");
    openClosureModalWithState(snap);
  }, [postAgentCtx, openClosureModalWithState]);

  const handlePostAgentToggleTache = useCallback(
    (key: keyof AgentTachesState, value: boolean) => {
      setPostAgentTaches((prev) => {
        console.log("TACHES APRES TOGGLE:", { ...prev, [key]: value });
        const next = { ...prev, [key]: value };
        if (key === "generer_facture" && !value) {
          next.envoyer_facture_email = false;
        }
        tachesRef.current = next;
        return next;
      });
    },
    [],
  );

  const handlePostAgentSelectAll = useCallback((all: boolean) => {
    const email = (postAgentCtx?.draftSnapshot.clientEmail ?? "").trim();
    const next: AgentTachesState = {
      enregistrer_client: all,
      envoyer_bon_email: all && !!email,
      generer_facture: all,
      envoyer_facture_email: all,
      marquer_vendu: all,
      generer_cerfa: all,
      livre_police: all,
    };
    tachesRef.current = next;
    setPostAgentTaches(next);
  }, [postAgentCtx]);

  const handlePostAgentLancer = useCallback(async () => {
    if (!postAgentCtx?.draftSnapshot.id?.trim()) {
      toast({
        title: "Brouillon incomplet",
        description: "Identifiant du bon manquant. Réessayez après sauvegarde.",
        variant: "destructive",
      });
      return;
    }
    console.log("=== AGENT IA LAUNCH ===");
    const t = tachesRef.current;
    const lp = livrePoliceRef.current;
    console.log("Tâches envoyées à l'agent:", {
      enregistrer_client: t.enregistrer_client,
      envoyer_bon_email: t.envoyer_bon_email,
      generer_facture: t.generer_facture,
      envoyer_facture_email: t.envoyer_facture_email,
      marquer_vendu: t.marquer_vendu,
      generer_cerfa: t.generer_cerfa,
      livre_police: t.livre_police,
    });
    console.log("State taches complet:", t);
    console.log("Livre police data:", lp);

    const tachesAEnvoyer = {
      enregistrer_client: t.enregistrer_client ?? true,
      envoyer_bon_email: t.envoyer_bon_email ?? true,
      generer_facture: t.generer_facture ?? true,
      envoyer_facture_email: t.envoyer_facture_email ?? true,
      marquer_vendu: t.marquer_vendu ?? true,
      generer_cerfa: t.generer_cerfa ?? false,
      livre_police: t.livre_police ?? true,
      livre_police_data: {
        prix_achat: lp.prix_achat || null,
        genre: lp.genre || "VP",
        pays_origine: lp.pays_origine || "France",
      },
    };

    console.log("TACHES ENVOYÉES:", JSON.stringify(tachesAEnvoyer));

    const order = buildAgentProgressOrder(tachesAEnvoyer as AgentTachesState);
    setPostAgentRunOrder(order);
    setPostAgentRunStepIdx(0);
    setPostAgentPhase("run");

    let step = 0;
    const iv = window.setInterval(() => {
      step = Math.min(step + 1, order.length);
      setPostAgentRunStepIdx(step);
    }, 800);

    const fixInterval = () => {
      window.clearInterval(iv);
    };

    try {
      const { data: sessionWrap } = await supabase.auth.getSession();
      const session = sessionWrap.session;
      const brouillonId = postAgentCtx.draftSnapshot.id.trim();

      const response = await fetch("/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          action: "agent-post-vente",
          brouillon_id: brouillonId,
          concession_id: session?.user?.id ?? "",
          taches: tachesAEnvoyer,
          pdf_base64: postAgentCtx.pdfBase64,
          form_data: postAgentCtx.formData,
          signature_vendeur_base64: postAgentCtx.signatureVendeurBase64 ?? undefined,
          bon_email_deja_envoye: postAgentCtx.emailDejaEnvoye,
          client_email: (postAgentCtx.draftSnapshot.clientEmail ?? "").trim(),
          client_nom: postAgentCtx.draftSnapshot.clientNom ?? "",
          client_prenom: postAgentCtx.draftSnapshot.clientPrenom ?? "",
          vehicule_modele: vehiculeTitreFromForm(postAgentCtx.draftSnapshot),
          vendeur_email: vendeurEmail,
          vendeur_nom: "Votre conseiller",
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        rapport?: AgentRapportLigne[];
        duration_ms?: number;
        error?: string;
      };
      fixInterval();
      setPostAgentRunStepIdx(order.length);
      if (!response.ok || !json.success) {
        toast({
          title: "Agent IA",
          description: json.error ?? "Une erreur est survenue.",
          variant: "destructive",
        });
        setPostAgentPhase("pick");
        return;
      }
      setPostAgentRapport(Array.isArray(json.rapport) ? json.rapport : []);
      setPostAgentDurationMs(typeof json.duration_ms === "number" ? json.duration_ms : 0);
      setPostAgentPhase("summary");
      window.dispatchEvent(new CustomEvent("autodocs_factures_updated"));
      window.dispatchEvent(new CustomEvent("autodocs_stock_updated"));
      window.dispatchEvent(new CustomEvent("autodocs_clients_updated"));
    } catch (e) {
      fixInterval();
      console.error(e);
      toast({
        title: "Agent IA",
        description: e instanceof Error ? e.message : "Erreur réseau.",
        variant: "destructive",
      });
      setPostAgentPhase("pick");
    }
  }, [postAgentCtx, vendeurEmail]);

  const closureClientLabel =
    closurePayload &&
    `${closurePayload.draftSnapshot.clientPrenom ?? ""} ${closurePayload.draftSnapshot.clientNom ?? ""}`.trim();

  const crmButtonDisabled =
    closureCrmUi === "linked_snapshot" ||
    closureCrmUi === "already_db" ||
    closureCrmUi === "saved" ||
    closureCrmUi === "checking" ||
    closureCrmUi === "saving";

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
                {formState.clientId ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-input border border-success/35 bg-success/15 px-3 py-2.5 text-sm text-foreground">
                    <span className="font-medium text-success">
                      Client sélectionné : {crmSelectedLabel}
                    </span>
                    <button
                      type="button"
                      onClick={handleCrmClientClear}
                      className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground cursor-pointer"
                      aria-label="Désélectionner le client"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ) : (
                  <div ref={crmSearchWrapRef} className="space-y-1.5">
                    <label className="field-label" htmlFor="crm-client-search">
                      Rechercher un client existant (CRM)
                    </label>
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden
                      />
                      <input
                        id="crm-client-search"
                        type="search"
                        autoComplete="off"
                        value={crmSearchInput}
                        onChange={(e) => setCrmSearchInput(e.target.value)}
                        onFocus={() => setCrmPickerOpen(true)}
                        placeholder="Rechercher un client existant…"
                        className="field-input w-full pl-9"
                      />
                      {crmSearchLoading ? (
                        <Loader2
                          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                      {showCrmDropdown ? (
                        <div
                          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-input border border-border bg-card py-1 shadow-lg"
                          role="listbox"
                        >
                          {crmSearchLoading ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">Recherche…</div>
                          ) : crmSearchResults.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-muted-foreground">
                              Aucun client trouvé
                            </div>
                          ) : (
                            crmSearchResults.map((c) => {
                              const line = `${c.prenom} ${c.nom}`.trim();
                              const email = c.email?.trim() || "—";
                              const phone = c.telephone?.trim() || "—";
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  role="option"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => handleCrmClientSelect(c)}
                                  className="flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/80"
                                >
                                  <span className="font-medium text-foreground">
                                    {line} — {email} — {phone}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
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
                repriseEstimation={{
                  estimation: repriseEstimation,
                  estimationLoading: repriseEstimationLoading,
                  onEstimer: estimerReprise,
                  onApplyRecommended: (prix) => {
                    updateForm({ repriseValeur: String(prix) });
                    setRepriseEstimation(null);
                  },
                }}
              />
            </div>

            <div className="card-autodocs border border-dashed border-border/50 bg-muted/[0.04]">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-input bg-muted/30 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div>
                  <h2 className="font-display text-sm font-semibold text-foreground/90">
                    Informations complémentaires
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    Optionnel — CERFA, fiche client &amp; livre de police si renseigné
                  </p>
                </div>
              </div>

              <div className="space-y-4 text-[13px]">
                <div className="space-y-4 rounded-xl border border-dashed border-border/80 bg-muted/[0.03] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      📷 Scanner la CNI <span className="text-xs">(optionnel)</span>
                    </span>
                    <span className="rounded-full bg-indigo-500/15 px-2 py-1 text-xs font-medium text-indigo-300">
                      Extrait : nom, prénom, date naissance, N° CNI
                    </span>
                  </div>
                  <ScanCni
                    hideOuterTitle
                    initialScan={formState.documentsScanned?.cni}
                    onScannedChange={handleCniScannedChange}
                    onExtracted={handleCniExtracted}
                  />
                  {isFieldEnabled(formPrefs, "clientNumeroCni") ? (
                    <label className="block">
                      <span className="field-label">N° CNI</span>
                      <div className="relative mt-1">
                        <input
                          type="text"
                          value={formState.clientNumeroCni}
                          onChange={(e) => {
                            updateForm({ clientNumeroCni: e.target.value });
                            setNumeroCniExtraitParIa(false);
                          }}
                          className={cn(
                            "field-input w-full",
                            numeroCniExtraitParIa && "pr-[11rem]",
                          )}
                          autoComplete="off"
                          placeholder="N° de CNI"
                        />
                        {numeroCniExtraitParIa ? (
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-green-500/10 px-2 py-1 text-xs text-green-400">
                            ✓ Extrait par IA
                          </span>
                        ) : null}
                      </div>
                    </label>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Véhicule
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-muted-foreground">N° VIN (17 car.)</span>
                      <input
                        type="text"
                        maxLength={17}
                        value={formState.cerfaVinComplement}
                        onChange={(e) =>
                          updateForm({
                            cerfaVinComplement: e.target.value.replace(/\s+/g, "").slice(0, 17),
                          })
                        }
                        className="field-input mt-1 w-full"
                        autoComplete="off"
                        placeholder="Pré-rempli depuis le stock si dispo"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">N° formule carte grise (9 max)</span>
                      <input
                        type="text"
                        maxLength={9}
                        value={formState.cerfaFormuleCarteGrise}
                        onChange={(e) =>
                          updateForm({
                            cerfaFormuleCarteGrise: e.target.value.replace(/\s+/g, "").slice(0, 9),
                          })
                        }
                        className="field-input mt-1 w-full"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-2 border-t border-border/40 pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Acheteur
                  </p>
                  <fieldset className="space-y-1">
                    <legend className="sr-only">Civilité acheteur</legend>
                    <span className="text-xs text-muted-foreground">Civilité</span>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {(
                        [
                          ["m", "M."],
                          ["mme", "Mme"],
                          ["morale", "Personne morale"],
                        ] as const
                      ).map(([val, label]) => (
                        <label
                          key={val}
                          className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-foreground/90"
                        >
                          <input
                            type="radio"
                            name="cerfa-acheteur-civilite"
                            checked={formState.cerfaAcheteurCivilite === val}
                            onChange={() => updateForm({ cerfaAcheteurCivilite: val })}
                            className="accent-primary"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Code postal</span>
                      <input
                        type="text"
                        value={formState.cerfaAcheteurCodePostal}
                        onChange={(e) =>
                          updateForm({ cerfaAcheteurCodePostal: e.target.value.slice(0, 10) })
                        }
                        className="field-input mt-1 w-full"
                        autoComplete="postal-code"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">Ville</span>
                      <input
                        type="text"
                        value={formState.cerfaAcheteurVille}
                        onChange={(e) => updateForm({ cerfaAcheteurVille: e.target.value })}
                        className="field-input mt-1 w-full"
                        autoComplete="address-level2"
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Lieu de naissance</span>
                    <input
                      type="text"
                      value={formState.cerfaAcheteurLieuNaissance}
                      onChange={(e) => updateForm({ cerfaAcheteurLieuNaissance: e.target.value })}
                      className="field-input mt-1 w-full"
                      autoComplete="off"
                    />
                  </label>
                </div>
              </div>
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
        onSuccessfulModalClosed={handleSuccessfulModalClosed}
      />

      {/* Délégation agent IA — après succès PDF, avant la popup « Clôturer la vente » */}
      {postAgentOpen && postAgentCtx ? (
        <>
          <div className="pointer-events-none fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm" aria-hidden />
          <div
            className="fixed inset-x-4 bottom-auto top-1/2 z-[10001] mx-auto max-h-[90vh] max-w-lg -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#1A1D27] p-6 shadow-2xl pointer-events-auto md:inset-x-auto md:left-1/2 md:w-full md:max-w-lg md:-translate-x-1/2"
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-agent-title"
          >
            {postAgentPhase === "pick" ? (
              <>
                <h2
                  id="post-agent-title"
                  className="mb-4 font-display text-base font-bold text-foreground"
                >
                  🤖 Que voulez-vous déléguer à l&apos;agent IA ?
                </h2>
                <ul className="space-y-3 text-sm text-foreground">
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-client"
                      data-tache="enregistrer_client"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      checked={postAgentTaches.enregistrer_client}
                      onChange={(e) =>
                        handlePostAgentToggleTache("enregistrer_client", e.target.checked)
                      }
                    />
                    <label htmlFor="tache-client" className="cursor-pointer leading-snug">
                      Enregistrer la fiche client
                    </label>
                  </li>
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-bon-mail"
                      data-tache="envoyer_bon_email"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-40"
                      checked={postAgentTaches.envoyer_bon_email}
                      disabled={!(postAgentCtx.draftSnapshot.clientEmail ?? "").trim()}
                      title={
                        !(postAgentCtx.draftSnapshot.clientEmail ?? "").trim()
                          ? "Aucun email client dans le formulaire : impossible d’envoyer le bon."
                          : undefined
                      }
                      onChange={(e) =>
                        handlePostAgentToggleTache("envoyer_bon_email", e.target.checked)
                      }
                    />
                    <label
                      htmlFor="tache-bon-mail"
                      className={cn(
                        "leading-snug",
                        (postAgentCtx.draftSnapshot.clientEmail ?? "").trim()
                          ? "cursor-pointer"
                          : "cursor-not-allowed text-muted-foreground",
                      )}
                    >
                      Envoyer le bon de commande par email
                    </label>
                  </li>
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-facture"
                      data-tache="generer_facture"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      checked={postAgentTaches.generer_facture}
                      onChange={(e) =>
                        handlePostAgentToggleTache("generer_facture", e.target.checked)
                      }
                    />
                    <label htmlFor="tache-facture" className="cursor-pointer leading-snug">
                      Générer la facture
                    </label>
                  </li>
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-facture-mail"
                      data-tache="envoyer_facture_email"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-40"
                      checked={postAgentTaches.envoyer_facture_email}
                      disabled={!postAgentTaches.generer_facture}
                      onChange={(e) =>
                        handlePostAgentToggleTache("envoyer_facture_email", e.target.checked)
                      }
                    />
                    <label htmlFor="tache-facture-mail" className="cursor-pointer leading-snug">
                      Envoyer la facture par email
                    </label>
                  </li>
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-vendu"
                      data-tache="marquer_vendu"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      checked={postAgentTaches.marquer_vendu}
                      onChange={(e) =>
                        handlePostAgentToggleTache("marquer_vendu", e.target.checked)
                      }
                    />
                    <label htmlFor="tache-vendu" className="cursor-pointer leading-snug">
                      Marquer le véhicule comme vendu
                    </label>
                  </li>
                  <li className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        id="tache-livre-police"
                        data-tache="livre_police"
                        checked={postAgentTaches.livre_police}
                        onChange={(e) =>
                          handlePostAgentToggleTache("livre_police", e.target.checked)
                        }
                        className="w-4 h-4 rounded accent-indigo-500"
                      />
                      <span className="text-sm text-gray-200">
                        📋 Créer l&apos;entrée dans le livre de police
                      </span>
                    </label>
                    {postAgentTaches.livre_police ? (
                      <div className="ml-7 mt-2 p-3 bg-gray-800/40 border border-gray-700/50 rounded-lg">
                        <label className="text-xs text-gray-400 block mb-1">
                          Prix d&apos;achat du véhicule par la concession (€)
                          <span className="text-gray-600 ml-1">— optionnel</span>
                        </label>
                        <input
                          type="number"
                          value={livrePoliceData.prix_achat}
                          onChange={(e) =>
                            setLivrePoliceData((prev) => {
                              const next = { ...prev, prix_achat: e.target.value };
                              livrePoliceRef.current = next;
                              return next;
                            })
                          }
                          placeholder="ex: 12000"
                          className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                        />
                      </div>
                    ) : null}
                  </li>
                  <li className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      id="tache-cerfa"
                      data-tache="generer_cerfa"
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                      checked={postAgentTaches.generer_cerfa}
                      onChange={(e) =>
                        handlePostAgentToggleTache("generer_cerfa", e.target.checked)
                      }
                    />
                    <label htmlFor="tache-cerfa" className="cursor-pointer leading-snug">
                      Générer le CERFA
                    </label>
                  </li>
                </ul>

                {postAgentTaches.generer_cerfa ? (
                  <p className="mt-4 rounded-lg border border-dashed border-border/60 bg-muted/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    VIN, n° de formule et coordonnées acheteur pour le CERFA sont lus depuis le formulaire du bon
                    (section « Informations complémentaires »). Le vendeur reste la concession (personne morale).
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline cursor-pointer"
                    onClick={() => handlePostAgentSelectAll(true)}
                  >
                    Tout sélectionner
                  </button>
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline cursor-pointer"
                    onClick={() => handlePostAgentSelectAll(false)}
                  >
                    Tout désélectionner
                  </button>
                </div>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="btn-secondary order-2 cursor-pointer sm:order-1"
                    onClick={handlePostAgentManual}
                  >
                    Faire manuellement
                  </button>
                  <button
                    type="button"
                    className="btn-primary order-1 cursor-pointer border-0 sm:order-2"
                    onClick={() => void handlePostAgentLancer()}
                  >
                    <span className="inline-flex items-center gap-2">🤖 Lancer l&apos;agent IA</span>
                  </button>
                </div>
              </>
            ) : null}

            {postAgentPhase === "run" ? (
              <>
                <h2
                  id="post-agent-title"
                  className="mb-4 font-display text-base font-bold text-foreground"
                >
                  🤖 Agent IA en cours…
                </h2>
                <ul className="space-y-2.5 text-sm">
                  {postAgentRunOrder.map((row, i) => {
                    const done = i < postAgentRunStepIdx;
                    const active =
                      i === postAgentRunStepIdx && postAgentRunStepIdx < postAgentRunOrder.length;
                    return (
                      <li key={row.id} className="flex items-center gap-2 text-foreground">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                        ) : active ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
                        )}
                        <span className={cn(active ? "font-medium text-foreground" : "text-muted-foreground")}>
                          {row.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                      style={{
                        width: `${
                          postAgentRunOrder.length === 0
                            ? 0
                            : Math.min(
                                100,
                                Math.round((postAgentRunStepIdx / postAgentRunOrder.length) * 100),
                              )
                        }%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-center text-xs text-muted-foreground">
                    {postAgentRunOrder.length === 0
                      ? "0%"
                      : `${Math.min(100, Math.round((postAgentRunStepIdx / postAgentRunOrder.length) * 100))}%`}
                  </p>
                </div>
              </>
            ) : null}

            {postAgentPhase === "summary" ? (
              <>
                <h2
                  id="post-agent-title"
                  className="mb-4 text-center font-display text-lg font-bold text-foreground"
                >
                  🎉 Agent IA terminé !
                </h2>
                <ul className="space-y-2 text-sm">
                  {postAgentRapport.map((line, idx) => (
                    <li key={`${line.tache}-${idx}-${line.message.slice(0, 24)}`} className="flex items-start gap-2">
                      {line.statut === "ok" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                      ) : line.statut === "err" ? (
                        <span className="mt-0.5 text-destructive" aria-hidden>
                          ✕
                        </span>
                      ) : line.statut === "warn" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="text-foreground">{line.message}</span>
                    </li>
                  ))}
                </ul>
                {(() => {
                  const cerfaLine = postAgentRapport.find((r) => r.tache === "cerfa" && r.pdf_base64);
                  const b64 = cerfaLine?.pdf_base64;
                  if (!b64) return null;
                  return (
                    <div className="mt-4 flex justify-center">
                      <button
                        type="button"
                        className="btn-secondary cursor-pointer px-5 py-2.5 text-sm"
                        onClick={() => downloadBase64Pdf(b64, `cerfa-${Date.now()}.pdf`)}
                      >
                        📄 Télécharger le CERFA
                      </button>
                    </div>
                  );
                })()}
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {(() => {
                    const ok = postAgentRapport.filter((x) => x.statut === "ok").length;
                    const total = postAgentRapport.length || 1;
                    const sec = Math.max(1, Math.round(postAgentDurationMs / 1000));
                    return `${ok}/${total} actions réalisées en ${sec} seconde${sec > 1 ? "s" : ""}`;
                  })()}
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    className="btn-primary cursor-pointer border-0"
                    onClick={handleClosureFermer}
                  >
                    Nouveau bon
                  </button>
                  <button
                    type="button"
                    className="btn-secondary cursor-pointer"
                    onClick={() => {
                      setPostAgentOpen(false);
                      setPostAgentCtx(null);
                      setPostAgentPhase("pick");
                      navigate("/historique");
                    }}
                  >
                    Voir l&apos;historique
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Modal clôture — après fermeture de la popup GenerateBar en succès */}
      {closureModalOpen && closurePayload ? (
        <>
          <div className="pointer-events-none fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm" aria-hidden />
          <div
            className="fixed inset-x-4 bottom-auto top-1/2 z-[10001] mx-auto max-h-[90vh] max-w-4xl -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#1A1D27] p-6 shadow-2xl pointer-events-auto md:inset-x-auto md:left-1/2 md:w-full md:-translate-x-1/2"
            role="dialog"
            aria-modal="true"
            aria-labelledby="closure-modal-title"
          >
            <h2
              id="closure-modal-title"
              className="mb-1 text-center font-display text-lg font-bold text-foreground"
            >
              Clôturer la vente
            </h2>
            <p className="mb-6 text-center text-base font-medium text-foreground">
              🎉 Bon de commande finalisé&nbsp;!
            </p>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  🚗 Marquer comme vendu
                </div>
                <p className="mb-3 text-sm font-medium text-foreground">
                  {closureVehicleLoading ? (
                    <span className="inline-flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Chargement…
                    </span>
                  ) : (
                    closurePayload.vehiculeDisplayLabel
                  )}
                </p>
                {!closurePayload.draftSnapshot.vehiculeStockId?.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    Pas de véhicule lié au stock sur ce bon.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={closureSoldDone || closureSoldSaving || closureVehicleLoading}
                    onClick={() => void handleClosureMarkSold()}
                    className={cn(
                      "mt-auto inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-bold transition-all",
                      closureSoldDone
                        ? "cursor-default bg-success/20 text-success ring-1 ring-success/40"
                        : "btn-primary cursor-pointer border-0",
                    )}
                  >
                    {closureSoldSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        …
                      </>
                    ) : closureSoldDone ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        ✓ Vendu
                      </>
                    ) : (
                      "Marquer comme vendu"
                    )}
                  </button>
                )}
              </div>

              <div className="flex flex-col rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  👤 Enregistrer le client
                </div>
                <p className="mb-3 text-sm font-medium text-foreground">
                  {closureClientLabel || "—"}
                </p>
                <button
                  type="button"
                  disabled={crmButtonDisabled}
                  onClick={() => void handleClosureRegisterCrm()}
                  className={cn(
                    "mt-auto inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-bold transition-all",
                    closureCrmUi === "linked_snapshot" ||
                      closureCrmUi === "already_db" ||
                      closureCrmUi === "saved"
                      ? "cursor-default bg-success/20 text-success ring-1 ring-success/40"
                      : "btn-primary cursor-pointer border-0",
                  )}
                >
                  {closureCrmUi === "checking" || closureCrmUi === "saving" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {closureCrmUi === "checking" ? "Vérification…" : "Enregistrement…"}
                    </>
                  ) : closureCrmUi === "linked_snapshot" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      ✓ Déjà enregistré
                    </>
                  ) : closureCrmUi === "already_db" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      ✓ Déjà enregistré
                    </>
                  ) : closureCrmUi === "saved" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      ✓ Client enregistré
                    </>
                  ) : (
                    "Enregistrer dans le CRM"
                  )}
                </button>
              </div>

              <div className="flex flex-col rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  🧾 Générer la facture
                </div>
                <p className="mb-3 text-sm text-muted-foreground">
                  Créer la facture de vente pour ce bon de commande
                </p>
                {(() => {
                  const ds = closurePayload.draftSnapshot;
                  console.log("Données facture dispo:", {
                    vehicule: closurePayload.vehiculeDisplayLabel,
                    prix: ds.vehiculePrix,
                    client: `${ds.clientPrenom ?? ""} ${ds.clientNom ?? ""}`.trim(),
                    brouillonId: ds.id ?? null,
                  });
                  return null;
                })()}
                {closureFactureDone ? (
                  <div className="mt-auto flex flex-col gap-2">
                    <div
                      className={cn(
                        "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-bold ring-1",
                        "cursor-default bg-success/20 text-success ring-success/40",
                      )}
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                      ✓ Facture générée
                    </div>
                    <button
                      type="button"
                      className="text-center text-[13px] font-semibold text-primary underline-offset-4 hover:underline cursor-pointer"
                      onClick={() =>
                        downloadBase64Pdf(
                          closureFactureDone.pdfBase64,
                          `facture-${closureFactureDone.numero_facture}.pdf`,
                        )
                      }
                    >
                      Télécharger à nouveau
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={closureFactureOpening}
                    onClick={() => void handleClosureOpenFactureModal()}
                    className={cn(
                      "mt-auto inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-display text-sm font-bold transition-all btn-primary cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    {closureFactureOpening ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        Ouverture…
                      </>
                    ) : (
                      <>
                        <Receipt className="h-4 w-4 shrink-0" aria-hidden />
                        Générer la facture
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-center border-t border-border/60 pt-4">
              <button type="button" className="btn-secondary cursor-pointer px-8" onClick={handleClosureFermer}>
                Fermer
              </button>
            </div>
          </div>
        </>
      ) : null}

      <FactureGenerateModal
        open={closureFactureModalOpen && !!closureFactureDraft}
        draft={closureFactureDraft}
        preset="closure"
        invoiceContact={
          closurePayload
            ? {
                client_email: closurePayload.draftSnapshot.clientEmail,
                client_telephone: closurePayload.draftSnapshot.clientTelephone,
                client_adresse: closurePayload.draftSnapshot.clientAdresse,
              }
            : null
        }
        onClose={() => {
          setClosureFactureModalOpen(false);
          setClosureFactureDraft(null);
        }}
        onSuccess={(data) => {
          setClosureFactureDone({
            numero_facture: data.numero_facture,
            pdfBase64: data.pdfBase64,
          });
        }}
      />
    </>
  );
};

export default NouveauBon;

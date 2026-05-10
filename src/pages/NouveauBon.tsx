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
} from "lucide-react";
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
import {
  getCustomFieldsBySection,
  isFieldEnabled,
  isStockColumnVisible,
  type FormFieldPrefs,
} from "@/utils/formPreferences";
import { cn } from "@/lib/utils";
import {
  getVehicule,
  markVehiculeVenduPourBon,
  vehiculePrixForBon,
} from "@/utils/stockVehicules";
import {
  attachDraftToClient,
  createClient,
  findClientExactNomPrenom,
  searchClientsAutocomplete,
  type ClientData,
} from "@/utils/clients";
import FactureGenerateModal from "@/components/FactureGenerateModal";
import { getFactureByBrouillonId } from "@/utils/factures";
import { downloadBase64Pdf } from "@/utils/generatePDF";

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
function findFirstClientPhoneCustomKey(prefs: FormFieldPrefs): string | null {
  for (const f of getCustomFieldsBySection(prefs, "client")) {
    const nk = stripDiacritics(`${f.key} ${f.label}`);
    if (
      nk.includes("telephone") ||
      nk.includes("tel") ||
      nk.includes("mobile") ||
      nk.includes("phone")
    ) {
      return f.key;
    }
  }
  return null;
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
  const formStateRef = useRef(formState);
  useEffect(() => {
    formStateRef.current = formState;
  }, [formState]);

  const [vendeurEmail, setVendeurEmail] = useState<string>("");
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse">
  >([]);

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
  }, [params.id]);

  const handleSuccessfulModalClosed = useCallback(() => {
    const fs = formStateRef.current;
    setClosurePayload({
      draftSnapshot: snapshotDraftForm(fs),
      vehiculeDisplayLabel: vehiculeTitreFromForm(fs),
    });
    setClosureCrmUi(fs.clientId ? "linked_snapshot" : "idle");
    setClosureSoldDone(false);
    setClosureSoldSaving(false);
    setClosureFactureDone(null);
    setClosureFactureModalOpen(false);
    setClosureFactureDraft(null);
    setClosureModalOpen(true);
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

  const handleCrmClientSelect = useCallback(
    (c: ClientData) => {
      const phoneKey = findFirstClientPhoneCustomKey(formPrefs);
      const tel = c.telephone?.trim() ?? "";
      setFormState((prev) => {
        const next: DraftFormState = {
          ...prev,
          clientId: c.id,
          clientNom: c.nom ?? "",
          clientPrenom: c.prenom ?? "",
          clientDateNaissance: c.dateNaissance ?? "",
          clientEmail: c.email ?? "",
        };
        if (phoneKey && tel) {
          next.customFieldsValues = { ...(prev.customFieldsValues ?? {}), [phoneKey]: tel };
          next.vehicleFieldValues = { ...(prev.vehicleFieldValues ?? {}), [phoneKey]: tel };
        }
        return next;
      });
      setAutoFilledClientFields([]);
      setCrmSearchInput("");
      setCrmSearchResults([]);
      setCrmPickerOpen(false);
    },
    [formPrefs],
  );

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
        const saved = await upsertDraft(ds);
        draftId = saved.id;
      }
      const tel = extractClientTelephone(ds.customFieldsValues);
      const created = await createClient({
        nom,
        prenom,
        email: ds.clientEmail?.trim() || "",
        telephone: tel,
        dateNaissance: ds.clientDateNaissance?.trim() || "",
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
    setFormState({ ...defaultFormState });
    setAutoFilledClientFields([]);
    navigate("/nouveau-bon", { replace: true });
  }, [navigate]);

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
                <ScanCni
                  initialScan={formState.documentsScanned?.cni}
                  onScannedChange={handleCniScannedChange}
                  onExtracted={handleCniExtracted}
                />
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

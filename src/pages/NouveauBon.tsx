import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { User, Car, Wallet, CreditCard } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import ScanCni from "@/components/nouveau-bon/ScanCni";
import VehiculeVente from "@/components/nouveau-bon/VehiculeVente";
import Reglement from "@/components/nouveau-bon/Reglement";
import GenerateBar, { countMissingMandatoryFields } from "@/components/nouveau-bon/GenerateBar";
import { BonFormStepper, computeBonStep } from "@/components/nouveau-bon/BonFormStepper";
import { toast } from "@/hooks/use-toast";
import { BonDraftData, getDraft, upsertDraft } from "@/utils/drafts";
import { supabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/auth";
import {
  DEFAULT_FORM_PREFS,
  isFieldEnabled,
  isStockColumnVisible,
  type FieldSection,
  type FieldType,
  type FormFieldPrefs,
} from "@/utils/formPreferences";

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
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse">
  >([]);
  const [formPrefs, setFormPrefs] = useState<FormFieldPrefs>(DEFAULT_FORM_PREFS);

  const parseSection = (value: unknown): FieldSection => {
    if (value === "client" || value === "vehicule" || value === "reprise" || value === "reglement") return value;
    return "client";
  };
  const parseType = (value: unknown): FieldType => {
    if (value === "number" || value === "date" || value === "text") return value;
    return "text";
  };
  const loadRawPreferences = async (cancelledRef?: { value: boolean }) => {
    const userId = await getCurrentUserId();
    if (!userId || cancelledRef?.value) return;
    const { data, error } = await supabase
      .from("preferences_formulaire")
      .select("champs_personnalises, champs_actifs")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data || cancelledRef?.value) return;
    const rawCustom = (data as { champs_personnalises?: unknown }).champs_personnalises;
    const rawToggles = (data as { champs_actifs?: unknown }).champs_actifs;
    const custom = Array.isArray(rawCustom) ? rawCustom : [];
    const toggles =
      rawToggles && typeof rawToggles === "object"
        ? (rawToggles as Record<string, unknown>)
        : {};
    setFormPrefs((prev) => {
      const standard = prev.fields.filter((f) => !f.isCustom);
      const parsedCustom = custom
        .filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object"))
        .map((field, idx) => {
          const key = String(field.key ?? field.field_key ?? `custom_${idx}`);
          const label = String(field.label ?? field.nom ?? field.name ?? key);
          const enabledRaw = toggles[key];
          return {
            id: String(field.id ?? `custom_raw_${key}`),
            key,
            label,
            section: parseSection(field.section),
            type: parseType(field.type),
            enabled: typeof enabledRaw === "boolean" ? enabledRaw : true,
            isCustom: true,
          };
        });
      return { fields: [...standard, ...parsedCustom] };
    });
  };

  useEffect(() => {
    const cancelled = { value: false };
    void loadRawPreferences(cancelled);
    return () => {
      cancelled.value = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => void loadRawPreferences();
    window.addEventListener("autodocs_form_prefs_updated", refresh);
    return () => {
      window.removeEventListener("autodocs_form_prefs_updated", refresh);
    };
  }, []);

  const step = useMemo(
    () => computeBonStep(formState),
    [formState.clientNom, formState.clientPrenom, formState.clientAdresse, formState.stockColonnes],
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

  const updateForm = (patch: Partial<DraftFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
  };
  const updateCustomField = (key: string, value: string) => {
    setFormState((prev) => ({
      ...prev,
      customFieldsValues: { ...(prev.customFieldsValues ?? {}), [key]: value },
      vehicleFieldValues: { ...(prev.vehicleFieldValues ?? {}), [key]: value },
    }));
  };

  const handleCniExtracted = (
    patch: Partial<BonDraftData>,
    highlightedFields: Array<keyof BonDraftData>,
  ) => {
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
  };

  const handleCniScannedChange = (state: BonDraftData["documentsScanned"][string] | null) => {
    setFormState((prev) => {
      const next = { ...(prev.documentsScanned ?? {}) };
      if (state) next.cni = state;
      else delete next.cni;
      return { ...prev, documentsScanned: next };
    });
  };

  const handleManualClientEdit = (
    field: "clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse",
  ) => {
    setAutoFilledClientFields((prev) => prev.filter((f) => f !== field));
  };

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
        templateId=""
      />
    </>
  );
};

export default NouveauBon;

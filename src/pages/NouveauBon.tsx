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

type DraftFormState = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
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
  vehiculePrix: "",
  modePaiement: "comptant",
  acompte: "",
  vehiculeRemise: "",
  vehiculeDateLivraison: "",
  documentsScanned: {},
};

function buildPdfFormData(form: DraftFormState): Record<string, string> {
  const repriseOn = form.repriseActive;
  return {
    clientNom: form.clientNom,
    clientPrenom: form.clientPrenom,
    clientDateNaissance: form.clientDateNaissance,
    clientNumeroCni: form.clientNumeroCni,
    clientAdresse: form.clientAdresse,
    stock_donnees: JSON.stringify(form.stockDonnees ?? {}),
    stock_colonnes: JSON.stringify(form.stockColonnes ?? []),
    repriseActive: repriseOn ? "oui" : "non",
    reprise_plaque: repriseOn ? form.reprisePlaque : "",
    reprise_marque: repriseOn ? form.repriseMarque : "",
    reprise_modele: repriseOn ? form.repriseModele : "",
    reprise_vin: repriseOn ? form.repriseVin : "",
    reprise_premiere_circulation: repriseOn ? form.reprisePremiereCirculation : "",
    reprise_valeur: repriseOn ? form.repriseValeur : "",
    vehiculePrix: form.vehiculePrix,
    modePaiement: form.modePaiement,
    acompte: form.acompte,
    vehiculeRemise: form.vehiculeRemise,
    vehiculeDateLivraison: form.vehiculeDateLivraison,
  };
}

const NouveauBon = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse">
  >([]);

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
      setFormState({ ...defaultFormState, ...rest, id });
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const updateForm = (patch: Partial<DraftFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
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

  const handleSaveDraft = async () => {
    try {
      const saved = await upsertDraft(formState);
      toast({ title: "Brouillon sauvegardé" });
      navigate("/");
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
              onClick={() => navigate("/")}
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
              <VehiculeVente form={formState} onChange={updateForm} />
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
              <Reglement form={formState} onChange={updateForm} />
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
        formData={buildPdfFormData(formState)}
        templateId=""
      />
    </>
  );
};

export default NouveauBon;

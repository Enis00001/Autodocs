import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import ScanCni from "@/components/nouveau-bon/ScanCni";
import VehiculeVente from "@/components/nouveau-bon/VehiculeVente";
import Reglement from "@/components/nouveau-bon/Reglement";
import GenerateBar, { countMissingMandatoryFields } from "@/components/nouveau-bon/GenerateBar";
import { toast } from "@/hooks/use-toast";
import { BonDraftData, getDraft, upsertDraft } from "@/utils/drafts";

type DraftFormState = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

const defaultFormState: DraftFormState = {
  id: undefined,
  // Section 1 — Client
  clientNom: "",
  clientPrenom: "",
  clientDateNaissance: "",
  clientNumeroCni: "",
  clientAdresse: "",
  // Section 2 — Véhicule (snapshot du stock, schéma libre)
  vehiculeStockId: "",
  stockDonnees: {},
  stockColonnes: [],
  // Section 2b — Reprise
  repriseActive: false,
  reprisePlaque: "",
  repriseMarque: "",
  repriseModele: "",
  repriseVin: "",
  reprisePremiereCirculation: "",
  repriseValeur: "",
  // Section 3 — Règlement
  vehiculePrix: "",
  modePaiement: "comptant",
  acompte: "",
  vehiculeRemise: "",
  vehiculeDateLivraison: "",
  // Scans
  documentsScanned: {},
};

/**
 * Projette le formState en dictionnaire plat pour le template PDF.
 *
 * V2 : côté véhicule, on n'envoie plus de champs typés. On sérialise
 * `stock_donnees` et `stock_colonnes` — la serverless function génère un
 * tableau dynamique clé/valeur dans la section véhicule.
 */
function buildPdfFormData(form: DraftFormState): Record<string, string> {
  const repriseOn = form.repriseActive;
  const out: Record<string, string> = {
    clientNom: form.clientNom,
    clientPrenom: form.clientPrenom,
    clientDateNaissance: form.clientDateNaissance,
    clientNumeroCni: form.clientNumeroCni,
    clientAdresse: form.clientAdresse,

    // JSON stringifiés : reparsés côté serverless pour générer les lignes du
    // tableau véhicule.
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
  return out;
}

const NouveauBon = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [autoFilledClientFields, setAutoFilledClientFields] = useState<
    Array<"clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse">
  >([]);

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
      const { dismiss } = toast({ title: "Brouillon sauvegardé ✓" });
      setTimeout(() => dismiss(), 3000);
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
        actions={
          <>
            <button
              className="px-4 py-2 rounded-lg text-[13px] font-medium border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all bg-transparent cursor-pointer"
              onClick={() => navigate("/")}
            >
              Annuler
            </button>
            <button
              className="px-4 py-2 rounded-lg text-[13px] font-medium gradient-primary text-primary-foreground cursor-pointer transition-all hover:-translate-y-0.5 border-0"
              style={{ boxShadow: "0 0 20px hsla(228,91%,64%,0.25)" }}
              onClick={handleSaveDraft}
            >
              💾 Sauvegarder brouillon
            </button>
          </>
        }
      />
      <div className="page-shell">
        <div className="page-content">
          <div className="mb-5">
            <GenerateBar
              documentsUploaded={0}
              missingFieldsCount={countMissingMandatoryFields(formState as Record<string, unknown>)}
              formData={buildPdfFormData(formState)}
              templateId=""
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
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

            <div className="space-y-5">
              <VehiculeVente form={formState} onChange={updateForm} />
              <Reglement form={formState} onChange={updateForm} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default NouveauBon;

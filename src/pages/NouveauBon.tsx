import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import DocumentsClient from "@/components/nouveau-bon/DocumentsClient";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import VehiculeVente from "@/components/nouveau-bon/VehiculeVente";
import TemplateSelector from "@/components/nouveau-bon/TemplateSelector";
import GenerateBar, { countMissingMandatoryFields } from "@/components/nouveau-bon/GenerateBar";
import { toast } from "@/hooks/use-toast";
import { BonDraftData, getDraft, upsertDraft } from "@/utils/drafts";

type DraftFormState = Omit<BonDraftData, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
};

const defaultFormState: DraftFormState = {
  id: undefined,
  clientNom: "MARTIN",
  clientPrenom: "Jean",
  clientDateNaissance: "12/03/1985",
  clientNumeroCni: "123456789012",
  clientAdresse: "14 rue des Lilas, 69003 Lyon",
  clientEmail: "",
  clientTelephone: "",
  vehiculeModele: "",
  vehiculeVin: "",
  vehiculePremiereCirculation: "",
  vehiculeKilometrage: "",
  vehiculeCo2: "",
  vehiculeChevaux: "",
  vehiculePrix: "",
  optionsMode: "total",
  optionsPrixTotal: "",
  optionsDetailJson: "[]",
  vehiculeCarteGrise: "",
  vehiculeFraisReprise: "",
  vehiculeRemise: "",
  vehiculeFinancement: "Comptant",
  vehiculeDateLivraison: "",
  vehiculeReprise: "",
  vehiculeCouleur: "",
  vehiculeOptions: "",
  acompte: "",
  modePaiement: "virement",
  apport: "",
  organismePreteur: "",
  montantCredit: "",
  tauxCredit: "",
  dureeMois: "",
  clauseSuspensive: false,
  vendeurNom: "",
  vendeurNotes: "",
  templateId: "1",
};

const NouveauBon = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [documentsUploaded, setDocumentsUploaded] = useState(0);
  const [highlightedFields, setHighlightedFields] = useState<Array<keyof DraftFormState>>([]);

  useEffect(() => {
    if (params.id) {
      getDraft(params.id).then((existing) => {
        if (existing) {
          const { id, createdAt, updatedAt, ...rest } = existing;
          setFormState({ ...defaultFormState, ...rest, id });
        }
      });
    } else {
      setFormState(defaultFormState);
    }
  }, [params.id]);

  const updateForm = (patch: Partial<DraftFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
  };

  const handleExtractedData = (
    patch: Partial<DraftFormState>,
    fields: Array<keyof DraftFormState>
  ) => {
    setFormState((prev) => ({ ...prev, ...patch }));
    if (fields.length > 0) {
      setHighlightedFields((prev) => Array.from(new Set([...prev, ...fields])));
    }
  };

  const handleSaveDraft = async () => {
    const saved = await upsertDraft(formState);
    const { dismiss } = toast({
      title: "Brouillon sauvegardé ✓",
    });
    setTimeout(() => {
      dismiss();
    }, 3000);
    navigate("/");
    setFormState((prev) => ({ ...prev, id: saved.id }));
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
      <div className="flex-1 overflow-y-auto p-7 grid grid-cols-2 gap-5 content-start">
        <DocumentsClient
          vehiculeFinancement={formState.vehiculeFinancement}
          onDocumentsChange={setDocumentsUploaded}
          currentAdresse={formState.clientAdresse}
          onExtractedData={(
            patch: Partial<BonDraftData>,
            fields: Array<keyof BonDraftData>
          ) =>
            handleExtractedData(
              patch as Partial<DraftFormState>,
              fields as Array<keyof DraftFormState>
            )
          }
        />
        <ProfilClient
          form={formState}
          onChange={updateForm}
          autoFilledFields={highlightedFields as Array<
            "clientNom" | "clientPrenom" | "clientDateNaissance" | "clientNumeroCni" | "clientAdresse"
          >}
        />
        <VehiculeVente form={formState} onChange={updateForm} />
        <TemplateSelector selectedTemplateId={formState.templateId} onChangeTemplate={(id) => updateForm({ templateId: id })} />
        <GenerateBar
          documentsUploaded={documentsUploaded}
          missingFieldsCount={countMissingMandatoryFields(formState)}
        />
      </div>
    </>
  );
};

export default NouveauBon;

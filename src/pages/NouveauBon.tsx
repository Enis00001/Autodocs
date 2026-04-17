import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import TopBar from "@/components/layout/TopBar";
import ProfilClient from "@/components/nouveau-bon/ProfilClient";
import VehiculeVente from "@/components/nouveau-bon/VehiculeVente";
import TemplateSelector from "@/components/nouveau-bon/TemplateSelector";
import GenerateBar, { countMissingMandatoryFields } from "@/components/nouveau-bon/GenerateBar";
import { toast } from "@/hooks/use-toast";
import { BonDraftData, getDraft, upsertDraft } from "@/utils/drafts";
import { getCurrentUserId } from "@/lib/auth";
import {
  addVehicleField,
  deleteVehicleField,
  loadVehicleFields,
  reorderVehicleFields,
  updateVehicleField,
  type VehicleFieldRow,
} from "@/utils/vehicleFields";
import { loadFieldPreferences, saveFieldPreferences } from "@/utils/bonFieldPreferences";
import {
  hasEntriesInTemplatesTable,
  loadPdfTemplates,
  pickPdfTemplateId,
  type PdfTemplateRow,
} from "@/utils/pdfTemplates";

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
  ribTitulaire: "",
  ribIban: "",
  ribBic: "",
  ribBanque: "",
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
  templateId: "",
  documentsScanned: {},
  vehicleFieldValues: {},
};

function buildPdfFormData(form: DraftFormState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (key === "id" || key === "documentsScanned" || key === "vehicleFieldValues") continue;
    if (typeof value === "boolean") {
      out[key] = value ? "oui" : "non";
    } else if (typeof value === "string") {
      out[key] = value;
    }
  }
  if (form.vehicleFieldValues && typeof form.vehicleFieldValues === "object") {
    for (const [k, v] of Object.entries(form.vehicleFieldValues)) {
      out[k] = String(v ?? "");
    }
  }
  return out;
}

const NouveauBon = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const [formState, setFormState] = useState<DraftFormState>(defaultFormState);
  const [customVehicleFields, setCustomVehicleFields] = useState<VehicleFieldRow[]>([]);
  const [hiddenVehiculeVenteKeys, setHiddenVehiculeVenteKeys] = useState<string[]>([]);
  const [pdfTemplates, setPdfTemplates] = useState<PdfTemplateRow[]>([]);
  const [pdfTemplatesLoading, setPdfTemplatesLoading] = useState(true);
  /** La page Templates affiche des fiches, mais aucune ligne `pdf_templates` (ex. modèles seed, Word, ou RLS). */
  const [libraryEntriesButNoAnalyzedPdf, setLibraryEntriesButNoAnalyzedPdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = await getCurrentUserId();
      if (!uid || cancelled) return;
      const defs = await loadVehicleFields(uid);
      if (cancelled) return;
      setCustomVehicleFields(defs);
      const prefs = loadFieldPreferences(uid);
      setHiddenVehiculeVenteKeys(prefs.hiddenKeys);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (customVehicleFields.length === 0) return;
    setFormState((prev) => {
      const next = { ...prev.vehicleFieldValues };
      let changed = false;
      for (const f of customVehicleFields) {
        if (!(f.field_key in next)) {
          next[f.field_key] = "";
          changed = true;
        }
      }
      return changed ? { ...prev, vehicleFieldValues: next } : prev;
    });
  }, [customVehicleFields, formState.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = await getCurrentUserId();
        if (!uid) {
          setPdfTemplates([]);
          setLibraryEntriesButNoAnalyzedPdf(false);
          return;
        }

        const list = await loadPdfTemplates(uid);
        if (cancelled) return;
        setPdfTemplates(list);
        const hasLibraryRows = await hasEntriesInTemplatesTable();
        if (cancelled) return;
        setLibraryEntriesButNoAnalyzedPdf(list.length === 0 && hasLibraryRows);

        if (params.id) {
          const existing = await getDraft(params.id);
          if (cancelled) return;
          if (existing) {
            const { id, createdAt, updatedAt, ...rest } = existing;
            setFormState({
              ...defaultFormState,
              ...rest,
              id,
              templateId: pickPdfTemplateId(list, rest.templateId),
            });
            return;
          }
        }

        setFormState((prev) => {
          if (!params.id) {
            return {
              ...defaultFormState,
              templateId: pickPdfTemplateId(list, ""),
            };
          }
          return {
            ...prev,
            templateId: pickPdfTemplateId(list, prev.templateId),
          };
        });
      } finally {
        if (!cancelled) setPdfTemplatesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const updateForm = (patch: Partial<DraftFormState>) => {
    setFormState((prev) => ({ ...prev, ...patch }));
  };

  const handleToggleStandardField = async (key: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const next = hiddenVehiculeVenteKeys.includes(key)
      ? hiddenVehiculeVenteKeys.filter((k) => k !== key)
      : [...hiddenVehiculeVenteKeys, key];
    setHiddenVehiculeVenteKeys(next);
    saveFieldPreferences(uid, { hiddenKeys: next });
  };

  const handleAddCustomVehicleField = async (label: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const created = await addVehicleField(uid, label);
    if (!created) return;
    setCustomVehicleFields((prev) =>
      [...prev, created].sort((a, b) => a.position - b.position),
    );
    setFormState((prev) => ({
      ...prev,
      vehicleFieldValues: {
        ...(prev.vehicleFieldValues ?? {}),
        [created.field_key]: "",
      },
    }));
  };

  const handleRenameCustomVehicleField = async (id: string, label: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const previous = customVehicleFields.find((f) => f.id === id);
    if (!previous) return;
    const updated = await updateVehicleField(id, uid, label);
    if (!updated) return;
    setCustomVehicleFields((prev) =>
      prev.map((f) => (f.id === id ? updated : f)).sort((a, b) => a.position - b.position),
    );
    if (previous.field_key !== updated.field_key) {
      setFormState((prev) => {
        const currentValues = { ...(prev.vehicleFieldValues ?? {}) };
        const oldValue = currentValues[previous.field_key] ?? "";
        delete currentValues[previous.field_key];
        currentValues[updated.field_key] = oldValue;
        return { ...prev, vehicleFieldValues: currentValues };
      });
    }
  };

  const handleDeleteCustomVehicleField = async (id: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const previous = customVehicleFields.find((f) => f.id === id);
    const ok = await deleteVehicleField(id, uid);
    if (!ok) return;
    setCustomVehicleFields((prev) => prev.filter((f) => f.id !== id));
    if (previous) {
      setFormState((prev) => {
        const nextValues = { ...(prev.vehicleFieldValues ?? {}) };
        delete nextValues[previous.field_key];
        return { ...prev, vehicleFieldValues: nextValues };
      });
    }
  };

  const handleReorderCustomVehicleFields = async (orderedIds: string[]) => {
    const uid = await getCurrentUserId();
    if (!uid || orderedIds.length === 0) return;
    const before = customVehicleFields;
    const byId = new Map(before.map((f) => [f.id, f]));
    const next = orderedIds
      .map((id, index) => {
        const f = byId.get(id);
        if (!f) return null;
        return { ...f, position: index };
      })
      .filter((f): f is VehicleFieldRow => Boolean(f));
    setCustomVehicleFields(next);
    const ok = await reorderVehicleFields(uid, orderedIds);
    if (!ok) {
      setCustomVehicleFields(before);
      return;
    }
    const refreshed = await loadVehicleFields(uid);
    setCustomVehicleFields(refreshed);
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
      <div className="page-shell">
        <div className="page-content">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
            <div className="space-y-5">
              <ProfilClient
                form={formState}
                onChange={updateForm}
                autoFilledFields={[]}
              />
              <TemplateSelector
                templates={pdfTemplates}
                loading={pdfTemplatesLoading}
                selectedTemplateId={formState.templateId}
                onChangeTemplate={(id) => updateForm({ templateId: id })}
                libraryEntriesButNoAnalyzedPdf={libraryEntriesButNoAnalyzedPdf}
              />
            </div>

            <VehiculeVente
              form={formState}
              onChange={updateForm}
              customVehicleFields={customVehicleFields}
              hiddenFieldKeys={hiddenVehiculeVenteKeys}
              onToggleStandardField={handleToggleStandardField}
              onAddCustomField={handleAddCustomVehicleField}
              onRenameCustomField={handleRenameCustomVehicleField}
              onDeleteCustomField={handleDeleteCustomVehicleField}
              onReorderCustomFields={handleReorderCustomVehicleFields}
            />

            <div className="xl:col-span-2 sticky bottom-0 z-20 pb-1 pt-2">
              <GenerateBar
                documentsUploaded={0}
                missingFieldsCount={countMissingMandatoryFields(formState as Record<string, unknown>)}
                formData={buildPdfFormData(formState)}
                templateId={formState.templateId}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default NouveauBon;

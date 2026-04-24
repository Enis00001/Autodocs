import type { BonDraftData } from "@/utils/drafts";
import { cn } from "@/lib/utils";
import {
  DEFAULT_FORM_PREFS,
  getCustomFieldsBySection,
  isFieldEnabled,
  type FormFieldPrefs,
} from "@/utils/formPreferences";

type ProfilField =
  | "clientNom"
  | "clientPrenom"
  | "clientDateNaissance"
  | "clientNumeroCni"
  | "clientAdresse";

type ProfilClientProps = {
  form: {
    clientNom: BonDraftData["clientNom"];
    clientPrenom: BonDraftData["clientPrenom"];
    clientDateNaissance: BonDraftData["clientDateNaissance"];
    clientNumeroCni: BonDraftData["clientNumeroCni"];
    clientAdresse: BonDraftData["clientAdresse"];
  };
  onChange: (patch: Partial<ProfilClientProps["form"]>) => void;
  autoFilledFields?: ProfilField[];
  prefs?: FormFieldPrefs;
  customValues?: Record<string, string>;
  onCustomFieldChange?: (key: string, value: string) => void;
};

const ProfilClient = ({
  form,
  onChange,
  autoFilledFields = [],
  prefs = DEFAULT_FORM_PREFS,
  customValues = {},
  onCustomFieldChange,
}: ProfilClientProps) => {
  const isEnabled = (field: ProfilField) => isFieldEnabled(prefs, field);
  const isAuto = (field: ProfilField) => autoFilledFields.includes(field);
  const autoClass = "field-input-auto pr-12";
  const customFields = getCustomFieldsBySection(prefs, "client");

  const Field = ({
    field,
    label,
    colSpan2,
  }: {
    field: ProfilField;
    label: string;
    colSpan2?: boolean;
  }) => {
    if (!isEnabled(field)) return null;
    return (
      <div className={cn("flex flex-col gap-1.5", colSpan2 && "md:col-span-2")}>
        <label className="field-label">{label}</label>
        <div className="relative">
          <input
            type="text"
            value={form[field]}
            onChange={(e) =>
              onChange({ [field]: e.target.value } as Partial<ProfilClientProps["form"]>)
            }
            className={cn("field-input", isAuto(field) && autoClass)}
            placeholder="—"
          />
          {isAuto(field) && (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none rounded bg-success/20 px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-success">
              Auto
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="card-title-autodocs">Identité & coordonnées</span>
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
          Vérifiez les champs
        </span>
      </div>
      <p className="text-xs text-muted-foreground">Saisie manuelle ou remplissage par scan CNI.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field field="clientNom" label="Nom" />
        <Field field="clientPrenom" label="Prénom" />
        <Field field="clientDateNaissance" label="Date de naissance" />
        <Field field="clientNumeroCni" label="N° CNI" />
        <Field field="clientAdresse" label="Adresse" colSpan2 />
        {customFields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5 md:col-span-2">
            <label className="field-label">{field.label}</label>
            <input
              type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
              className="field-input"
              value={customValues[field.key] ?? ""}
              onChange={(e) => onCustomFieldChange?.(field.key, e.target.value)}
              placeholder="—"
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProfilClient;

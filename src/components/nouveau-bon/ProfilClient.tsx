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

type ProfilFormShape = {
  clientNom: BonDraftData["clientNom"];
  clientPrenom: BonDraftData["clientPrenom"];
  clientDateNaissance: BonDraftData["clientDateNaissance"];
  clientNumeroCni: BonDraftData["clientNumeroCni"];
  clientAdresse: BonDraftData["clientAdresse"];
  clientEmail: BonDraftData["clientEmail"];
  clientTelephone: BonDraftData["clientTelephone"];
};

type ClientIdentityFieldProps = {
  field: ProfilField;
  label: string;
  colSpan2?: boolean;
  form: ProfilFormShape;
  onChange: (patch: Partial<ProfilFormShape>) => void;
  onManualEditField?: (field: ProfilField) => void;
  isEnabled: (field: ProfilField) => boolean;
  isAuto: (field: ProfilField) => boolean;
  autoClass: string;
};

const ClientIdentityField = ({
  field,
  label,
  colSpan2,
  form,
  onChange,
  onManualEditField,
  isEnabled,
  isAuto,
  autoClass,
}: ClientIdentityFieldProps) => {
  if (!isEnabled(field)) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", colSpan2 && "md:col-span-2")}>
      <label className="field-label">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={form[field]}
          onChange={(e) => {
            onChange({ [field]: e.target.value } as Partial<ProfilFormShape>);
            onManualEditField?.(field);
          }}
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

type ProfilClientProps = {
  form: ProfilFormShape;
  onChange: (patch: Partial<ProfilFormShape>) => void;
  autoFilledFields?: ProfilField[];
  onManualEditField?: (field: ProfilField) => void;
  prefs?: FormFieldPrefs;
  customValues?: Record<string, string>;
  onCustomFieldChange?: (key: string, value: string) => void;
};

const ProfilClient = ({
  form,
  onChange,
  autoFilledFields = [],
  onManualEditField,
  prefs = DEFAULT_FORM_PREFS,
  customValues = {},
  onCustomFieldChange,
}: ProfilClientProps) => {
  const isEnabled = (field: ProfilField) => isFieldEnabled(prefs, field);
  const isAuto = (field: ProfilField) => autoFilledFields.includes(field);
  const autoClass = "field-input-auto pr-12";
  const customFields = getCustomFieldsBySection(prefs, "client");

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
        <ClientIdentityField
          field="clientNom"
          label="Nom"
          form={form}
          onChange={onChange}
          onManualEditField={onManualEditField}
          isEnabled={isEnabled}
          isAuto={isAuto}
          autoClass={autoClass}
        />
        <ClientIdentityField
          field="clientPrenom"
          label="Prénom"
          form={form}
          onChange={onChange}
          onManualEditField={onManualEditField}
          isEnabled={isEnabled}
          isAuto={isAuto}
          autoClass={autoClass}
        />
        <ClientIdentityField
          field="clientDateNaissance"
          label="Date de naissance"
          colSpan2
          form={form}
          onChange={onChange}
          onManualEditField={onManualEditField}
          isEnabled={isEnabled}
          isAuto={isAuto}
          autoClass={autoClass}
        />
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label">
            Email <span className="font-normal text-muted-foreground">(optionnel pour le bon de commande)</span>
          </label>
          <input
            type="email"
            value={form.clientEmail}
            onChange={(e) => onChange({ clientEmail: e.target.value })}
            className="field-input"
            placeholder="email@exemple.com"
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label">
            Numéro de téléphone{" "}
            <span className="font-normal text-muted-foreground">(optionnel pour le bon de commande)</span>
          </label>
          <input
            type="tel"
            value={form.clientTelephone}
            onChange={(e) => onChange({ clientTelephone: e.target.value })}
            className="field-input"
            placeholder="06 00 00 00 00"
            autoComplete="tel"
          />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label">
            Adresse complète{" "}
            <span className="font-normal text-muted-foreground">(optionnel pour le bon de commande)</span>
          </label>
          <textarea
            value={form.clientAdresse}
            onChange={(e) => onChange({ clientAdresse: e.target.value })}
            className="field-input min-h-[72px] resize-y"
            placeholder="Adresse, Code postal, Ville"
            rows={3}
          />
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground/90 md:col-span-2">
          Ces informations sont utilisées pour la facture et la fiche client — non affichées sur le bon de
          commande.
        </p>
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

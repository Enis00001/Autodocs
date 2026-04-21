import type { BonDraftData } from "@/utils/drafts";

type ProfilClientProps = {
  form: {
    clientNom: BonDraftData["clientNom"];
    clientPrenom: BonDraftData["clientPrenom"];
    clientDateNaissance: BonDraftData["clientDateNaissance"];
    clientNumeroCni: BonDraftData["clientNumeroCni"];
    clientAdresse: BonDraftData["clientAdresse"];
  };
  onChange: (patch: Partial<ProfilClientProps["form"]>) => void;
  autoFilledFields?: Array<
    | "clientNom"
    | "clientPrenom"
    | "clientDateNaissance"
    | "clientNumeroCni"
    | "clientAdresse"
  >;
};

const ProfilClient = ({ form, onChange, autoFilledFields = [] }: ProfilClientProps) => {
  const isAuto = (
    field:
      | "clientNom"
      | "clientPrenom"
      | "clientDateNaissance"
      | "clientNumeroCni"
      | "clientAdresse",
  ) => autoFilledFields.includes(field);
  const autoClass = "bg-success/10 border-success/40";

  return (
    <div className="card-autodocs">
      <div className="flex items-center justify-between mb-4">
        <span className="card-title-autodocs">👤 Profil client</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-success/15 text-success">
          Auto-rempli par IA
        </span>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Vérifiez les informations client avant génération du bon.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Nom</label>
          <input
            type="text"
            value={form.clientNom}
            onChange={(e) => onChange({ clientNom: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientNom") ? autoClass : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Prénom</label>
          <input
            type="text"
            value={form.clientPrenom}
            onChange={(e) => onChange({ clientPrenom: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientPrenom") ? autoClass : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Date de naissance</label>
          <input
            type="text"
            value={form.clientDateNaissance}
            onChange={(e) => onChange({ clientDateNaissance: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientDateNaissance") ? autoClass : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">N° CNI</label>
          <input
            type="text"
            value={form.clientNumeroCni}
            onChange={(e) => onChange({ clientNumeroCni: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientNumeroCni") ? autoClass : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1.5 md:col-span-2">
          <label className="field-label">Adresse</label>
          <input
            type="text"
            value={form.clientAdresse}
            onChange={(e) => onChange({ clientAdresse: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientAdresse") ? autoClass : ""}`}
          />
        </div>
      </div>
    </div>
  );
};

export default ProfilClient;

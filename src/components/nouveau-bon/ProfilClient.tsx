import type { BonDraftData } from "@/utils/drafts";

type ProfilClientProps = {
  form: {
    clientNom: BonDraftData["clientNom"];
    clientPrenom: BonDraftData["clientPrenom"];
    clientDateNaissance: BonDraftData["clientDateNaissance"];
    clientNumeroCni: BonDraftData["clientNumeroCni"];
    clientAdresse: BonDraftData["clientAdresse"];
    ribTitulaire: BonDraftData["ribTitulaire"];
    ribIban: BonDraftData["ribIban"];
    ribBic: BonDraftData["ribBic"];
    ribBanque: BonDraftData["ribBanque"];
    clientEmail: BonDraftData["clientEmail"];
    clientTelephone: BonDraftData["clientTelephone"];
  };
  onChange: (patch: Partial<ProfilClientProps["form"]>) => void;
  autoFilledFields?: Array<
    | "clientNom"
    | "clientPrenom"
    | "clientDateNaissance"
    | "clientNumeroCni"
    | "clientAdresse"
    | "ribTitulaire"
    | "ribIban"
    | "ribBic"
    | "ribBanque"
  >;
};

const ProfilClient = ({ form, onChange, autoFilledFields = [] }: ProfilClientProps) => {
  const isAuto = (
    field:
      | "clientNom"
      | "clientPrenom"
      | "clientDateNaissance"
      | "clientNumeroCni"
      | "clientAdresse"
      | "ribTitulaire"
      | "ribIban"
      | "ribBic"
      | "ribBanque"
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

      <div className="grid grid-cols-2 gap-3">
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
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="field-label">Adresse</label>
          <input
            type="text"
            value={form.clientAdresse}
            onChange={(e) => onChange({ clientAdresse: e.target.value })}
            className={`field-input field-input-auto ${isAuto("clientAdresse") ? autoClass : ""}`}
          />
        </div>
        <div className="flex flex-col gap-1.5 col-span-2">
          <label className="card-title-autodocs" style={{ textTransform: "uppercase" }}>
            🏦 RIB
          </label>
          <div className="grid grid-cols-2 gap-3 mt-1.5">
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Titulaire</label>
              <input
                type="text"
                value={form.ribTitulaire}
                onChange={(e) => onChange({ ribTitulaire: e.target.value })}
                className={`field-input field-input-auto ${isAuto("ribTitulaire") ? autoClass : ""}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">IBAN</label>
              <input
                type="text"
                value={form.ribIban}
                onChange={(e) => onChange({ ribIban: e.target.value })}
                className={`field-input field-input-auto ${isAuto("ribIban") ? autoClass : ""}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">BIC</label>
              <input
                type="text"
                value={form.ribBic}
                onChange={(e) => onChange({ ribBic: e.target.value })}
                className={`field-input field-input-auto ${isAuto("ribBic") ? autoClass : ""}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="field-label">Banque</label>
              <input
                type="text"
                value={form.ribBanque}
                onChange={(e) => onChange({ ribBanque: e.target.value })}
                className={`field-input field-input-auto ${isAuto("ribBanque") ? autoClass : ""}`}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Email</label>
          <input
            type="text"
            placeholder="À saisir..."
            value={form.clientEmail}
            onChange={(e) => onChange({ clientEmail: e.target.value })}
            className="field-input"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="field-label">Téléphone</label>
          <input
            type="text"
            placeholder="À saisir..."
            value={form.clientTelephone}
            onChange={(e) => onChange({ clientTelephone: e.target.value })}
            className="field-input"
          />
        </div>
      </div>
    </div>
  );
};

export default ProfilClient;
